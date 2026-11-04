import type { LetterRegistrationField } from '@nodus/contracts';

/** Фокус в поле формы по ключу (Enter → следующее пустое, «Не хватает»). */
export function focusRegistrationField(
  root: HTMLElement | null,
  field: LetterRegistrationField | null,
): void {
  if (!root || !field) return;
  const el = root.querySelector<HTMLElement>(
    `[data-reg-field="${field}"] :is(input, textarea, button):not([disabled])`,
  );
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}
