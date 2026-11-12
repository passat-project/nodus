/**
 * Диагностика десктоп-попапов (#811): кольцевой журнал решений гейта.
 * Редкий «попап не пришёл» нельзя воспроизвести по требованию — после факта
 * должно быть видно, событие дошло и какой гейт его погасил: свой автор,
 * неактивное окно, «смотрю в чат», mute/snooze, тред-наблюдатель, отказ
 * оболочки. Пишем ТОЛЬКО id/типы/причины — без текста сообщений и имён
 * (публичный репозиторий и приватность).
 *
 * Хранилище — localStorage (≤ 100 записей) рядом с порталом: переживает
 * перезагрузку страницы и доступно из панели `?wsdebug=1`. Запись не должна
 * ронять попапы: недоступное хранилище — тихий no-op.
 */

/** Причина решения гейта (закрытый список; UI-подписи — i18n `wsDebug`). */
export type PopupGateReason =
  | 'not_shell'
  | 'invalid_payload'
  | 'own'
  | 'not_active'
  | 'looking'
  | 'muted'
  | 'snoozed'
  | 'thread_wait'
  | 'sent'
  | 'rejected';

export interface PopupDecision {
  /** Момент решения, UTC ISO 8601 (канон I7). */
  ts: string;
  messageId: string | null;
  conversationId: string | null;
  reason: PopupGateReason;
  /** Уточнение причины (код ошибки/валидации), без пользовательского текста. */
  detail?: string;
}

/** Потолок журнала: последние решения важнее старых, хранилище не пухнет. */
export const POPUP_DIAGNOSTICS_LIMIT = 100;
const STORAGE_KEY = 'nodus:popup-diagnostics';
const REASONS: ReadonlySet<string> = new Set<PopupGateReason>([
  'not_shell',
  'invalid_payload',
  'own',
  'not_active',
  'looking',
  'muted',
  'snoozed',
  'thread_wait',
  'sent',
  'rejected',
]);

const listeners = new Set<() => void>();
let buffer: PopupDecision[] = load();

function isDecision(value: unknown): value is PopupDecision {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.ts === 'string' &&
    (item.messageId === null || typeof item.messageId === 'string') &&
    (item.conversationId === null || typeof item.conversationId === 'string') &&
    typeof item.reason === 'string' &&
    REASONS.has(item.reason) &&
    (item.detail === undefined || typeof item.detail === 'string')
  );
}

function load(): PopupDecision[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDecision).slice(-POPUP_DIAGNOSTICS_LIMIT) : [];
  } catch {
    return []; // битое/недоступное хранилище — диагностика не критична
  }
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // Приватный режим/квота — журнал живёт в памяти до перезагрузки.
  }
}

/** Записать решение гейта (единственная точка изменения журнала). */
export function recordPopupDecision(
  decision: Omit<PopupDecision, 'ts'> & { ts?: string },
): PopupDecision {
  const entry: PopupDecision = {
    ts: decision.ts ?? new Date().toISOString(),
    messageId: decision.messageId,
    conversationId: decision.conversationId,
    reason: decision.reason,
    ...(decision.detail === undefined ? {} : { detail: decision.detail.slice(0, 120) }),
  };
  buffer = [...buffer, entry].slice(-POPUP_DIAGNOSTICS_LIMIT);
  persist();
  for (const fn of [...listeners]) fn();
  return entry;
}

/** Последние решения (старые → новые) — для панели диагностики. */
export function getPopupDecisions(): readonly PopupDecision[] {
  return buffer;
}

/** Подписка на новые записи (панель `?wsdebug=1`). */
export function subscribePopupDecisions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Очистить журнал (кнопка панели диагностики). */
export function clearPopupDecisions(): void {
  buffer = [];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // хранилище недоступно — чистим только память
    }
  }
  for (const fn of [...listeners]) fn();
}

/** Сброс журнала (только тесты). */
export function resetPopupDecisionsForTests(): void {
  clearPopupDecisions();
  listeners.clear();
}
