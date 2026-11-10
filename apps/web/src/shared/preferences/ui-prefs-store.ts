import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CardKind, CardTabsPref, UiPreferences } from '@nodus/contracts';

import { uiPrefsEnvelopeSchema, zodPersistMerge } from '../lib/persist-zod.js';
import { useAuthStore } from '../auth-store.js';

/**
 * Персонализация (концепт «Персональный порядок», #4; раскладка карточек —
 * #744/#745): ЛИЧНЫЙ и ОБЩИЙ (компания, «Применить порядок для всех» админа)
 * скоупы одним DTO contracts (`uiPreferencesSchema`) — формат зеркалит API
 * `GET/PUT /api/v1/me/preferences`. Пустой скоуп = слой не задан (личный ??
 * общий ?? системный). Верхние вкладки кастомизации не подлежат (вердикт #4).
 *
 * localStorage — мгновенный кэш, ключ НА ПОЛЬЗОВАТЕЛЯ
 * (`nodus-ui-prefs-v1:<userId>`): на общем компьютере настройки одного
 * сотрудника не применяются другому. После логина стор перечитывается из
 * ключа пользователя (и затем гидратируется серверным GET — ui-prefs-sync).
 */
interface UiPrefsState {
  personal: UiPreferences;
  company: UiPreferences;
  /** Порядок и скрытые модули рейки: forAll — пишем в общий скоуп (админ). */
  applyNav: (order: string[], hidden: string[], forAll: boolean) => void;
  /** Личная раскладка карточки вида (#746): оптимистично, сразу. */
  setCardTabs: (kind: CardKind, pref: CardTabsPref) => void;
  /** Полная замена личного слоя (гидратация с сервера). */
  replacePersonal: (preferences: UiPreferences) => void;
  /** Сброс ЛИЧНОГО слоя — «Вернуть по умолчанию». */
  resetPersonal: () => void;
}

const USERLESS_KEY = 'anonymous';
const STORE_NAME = 'nodus-ui-prefs-v1';

function scopedKey(userId: string | null): string {
  return `${STORE_NAME}:${userId ?? USERLESS_KEY}`;
}

const userScopedStorage = createJSONStorage<UiPrefsState>(() => ({
  getItem: () => localStorage.getItem(scopedKey(useAuthStore.getState().user?.id ?? null)),
  setItem: (_name: string, value: string) =>
    localStorage.setItem(scopedKey(useAuthStore.getState().user?.id ?? null), value),
  removeItem: () => localStorage.removeItem(scopedKey(useAuthStore.getState().user?.id ?? null)),
}));

/**
 * Прочитать кэш настроек ИМЕННО этого пользователя (не через rehydrate:
 * очистка стора перед rehydrate записывала пустой envelope в ключ нового
 * пользователя и стирала его кэш — гонка смены пользователя).
 */
function readScopedPreferences(userId: string | null): Pick<UiPrefsState, 'personal' | 'company'> {
  try {
    const raw = localStorage.getItem(scopedKey(userId));
    if (!raw) return { personal: {}, company: {} };
    const parsed = JSON.parse(raw) as { state?: unknown };
    const envelope = uiPrefsEnvelopeSchema.safeParse(parsed.state);
    return envelope.success ? envelope.data : { personal: {}, company: {} };
  } catch {
    return { personal: {}, company: {} };
  }
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set) => ({
      personal: {},
      company: {},
      applyNav: (order, hidden, forAll) =>
        set((s) =>
          forAll
            ? { company: { ...s.company, navOrder: order, navHidden: hidden } }
            : { personal: { ...s.personal, navOrder: order, navHidden: hidden } },
        ),
      setCardTabs: (kind, pref) =>
        set((s) => ({
          personal: {
            ...s.personal,
            cardTabs: { ...s.personal.cardTabs, [kind]: pref },
          },
        })),
      replacePersonal: (preferences) => set({ personal: preferences }),
      resetPersonal: () => set({ personal: {} }),
    }),
    {
      name: STORE_NAME,
      version: 1,
      storage: userScopedStorage,
      merge: zodPersistMerge<UiPrefsState>(uiPrefsEnvelopeSchema),
    },
  ),
);

/**
 * Смена пользователя (вход/выход/переключение): in-memory личный слой
 * очищается и перечитывается из ключа ЭТОГО пользователя. Кэш прежнего
 * пользователя в localStorage не удаляется — следующий вход быстрый.
 * Серверная гидратация — отдельно (`startPreferencesSync`).
 */
let currentUserId: string | null = useAuthStore.getState().user?.id ?? null;

useAuthStore.subscribe((state) => {
  const nextUserId = state.user?.id ?? null;
  if (nextUserId === currentUserId) return;
  currentUserId = nextUserId;
  // Читаем кэш НОВОГО пользователя и сразу ставим его; persist запишет это
  // значение в его же ключ (пустой — только если кэша действительно нет).
  useUiPrefsStore.setState(readScopedPreferences(nextUserId));
});
