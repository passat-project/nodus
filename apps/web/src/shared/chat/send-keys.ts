/**
 * Клавиатурный контракт композера (вердикт владельца 14.09.2026: «классика»):
 * Enter — отправить, ЛЮБОЙ Enter с модификатором (Shift/Ctrl/Meta/Alt) —
 * перенос строки. Чистые функции — детерминированный unit-тест без DOM.
 */

/** Минимум события клавиши для контракта (React-событие подходит как есть). */
export interface EnterKeyEvent {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Отправка: строго чистый Enter — без модификаторов. */
export function isSendShortcut(event: EnterKeyEvent): boolean {
  return (
    event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

/** Перенос строки клавиатурой: Enter + Ctrl/Meta/Alt. Shift+Enter сюда НЕ
 *  входит — его обрабатывает сам браузер (нативный перенос textarea),
 *  перехват дал бы двойной перенос. */
export function isNewlineShortcut(event: EnterKeyEvent): boolean {
  return event.key === 'Enter' && Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

/** IME-композиция (иероглифы): Enter подтверждает кандидата ввода — поле в
 *  этот момент не отправляет и не переносит строку (дефект #777). */
export function isImeComposing(event: { nativeEvent?: { isComposing?: boolean } }): boolean {
  return event.nativeEvent?.isComposing === true;
}
