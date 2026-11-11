import { userPreferencesResponseSchema, type UserPreferencesResponse } from '@nodus/contracts';

import { api } from '../api-client.js';
import { useAuthStore } from '../auth-store.js';
import { useUiPrefsStore } from './ui-prefs-store.js';

/**
 * Синхронизация личных настроек (#745): localStorage — мгновенный кэш,
 * сервер — перенос между компьютерами. Цикл:
 * - вход/смена пользователя → GET `/me/preferences`, серверный слой заменяет
 *   личный (кэш уже отрисован, без мигания);
 * - любое изменение (навигация, раскладка карточек) → оптимистично в сторе →
 *   debounce 500 мс → PUT всей личной формы (last-write-wins);
 * - ошибка сети/5xx — изменения остаются локально, повтор с backoff
 *   (2→5→15→30 с), тост не нужен: раскладка уже применена;
 * - выход — таймеры гасятся, in-memory личный слой очищает стор.
 */
const DEBOUNCE_MS = 500;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

let started = false;
let lastUserId: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryIndex = 0;
let hydrating = false;
/** Поколение запроса: смена пользователя отменяет поздние ответы. */
let generation = 0;

/** Маркер «есть неотправленные локальные изменения» НА ПОЛЬЗОВАТЕЛЯ.
 *  Переживает reload: иначе GET после перезагрузки в пределах debounce
 *  затирал бы локальную настройку старым серверным слоем. */
function dirtyKey(userId: string): string {
  return `nodus-ui-prefs-dirty:${userId}`;
}

function markDirty(userId: string): void {
  try {
    localStorage.setItem(dirtyKey(userId), '1');
  } catch {
    // localStorage недоступен — деградация к прежнему поведению.
  }
}

function clearDirty(userId: string): void {
  try {
    localStorage.removeItem(dirtyKey(userId));
  } catch {
    // см. выше
  }
}

function hasDirty(userId: string): boolean {
  try {
    return localStorage.getItem(dirtyKey(userId)) === '1';
  } catch {
    return false;
  }
}

function cancelTimers(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  retryIndex = 0;
}

async function hydrateFromServer(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const requestGeneration = generation;
  // Неотправленные локальные правки главнее серверного слоя (last-write-wins):
  // GET пропускаем, досылаем локальное.
  if (hasDirty(userId)) {
    schedulePush();
    return;
  }
  try {
    const response = await api<UserPreferencesResponse>('/me/preferences');
    if (requestGeneration !== generation || useAuthStore.getState().user?.id !== userId) return;
    const parsed = userPreferencesResponseSchema.safeParse(response);
    if (!parsed.success) return;
    hydrating = true;
    useUiPrefsStore.getState().replacePersonal(parsed.data.preferences);
  } catch {
    // Сервер недоступен/нет прав — живём на localStorage-кэше. PUT ниже
    // повторит запись, когда сеть вернётся.
  } finally {
    hydrating = false;
  }
}

async function pushToServer(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const requestGeneration = generation;
  const preferences = useUiPrefsStore.getState().personal;
  try {
    const response = await api<UserPreferencesResponse>('/me/preferences', {
      method: 'PUT',
      body: { preferences },
    });
    if (requestGeneration !== generation) return;
    const parsed = userPreferencesResponseSchema.safeParse(response);
    // Ответ сервера не перезаписывает локальный слой: пока летел запрос,
    // пользователь мог продолжить настройку (оптимистичность I4).
    if (!parsed.success) return;
    retryIndex = 0;
    // Маркер снимаем только если за время полёта не появились новые правки.
    if (preferences === useUiPrefsStore.getState().personal) clearDirty(userId);
  } catch {
    if (requestGeneration !== generation) return;
    const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)]!;
    retryIndex += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void pushToServer();
    }, delay);
  }
}

function schedulePush(): void {
  if (hydrating) return;
  const userId = useAuthStore.getState().user?.id;
  if (userId) markDirty(userId);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushToServer();
  }, DEBOUNCE_MS);
}

/** Запуск один раз на приложение (AppShell): подписки на auth и стор. */
export function startPreferencesSync(): void {
  if (started) return;
  started = true;

  lastUserId = useAuthStore.getState().user?.id ?? null;
  if (lastUserId) void hydrateFromServer();

  useAuthStore.subscribe((state) => {
    const nextUserId = state.user?.id ?? null;
    if (nextUserId === lastUserId) return;
    lastUserId = nextUserId;
    generation += 1;
    cancelTimers();
    if (nextUserId) void hydrateFromServer();
  });

  useUiPrefsStore.subscribe((state, previous) => {
    if (state.personal === previous.personal) return;
    if (!useAuthStore.getState().user) return;
    // Гидратация с сервера — не локальная правка: dirty не ставим.
    if (hydrating) return;
    schedulePush();
  });
}
