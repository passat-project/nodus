/**
 * Открытый popper-слой Radix (меню/поповер/селект) — владелец фокуса и Esc
 * (#71, канон «один Escape = один слой»): пока он реально открыт, слои под
 * ним клавишу не обрабатывают.
 *
 * Механика ловушки #1021: обёртка Radix (`data-radix-popper-content-wrapper`)
 * живёт в DOM ДО КОНЦА exit-анимации содержимого (`data-state="closed"` в
 * этот период; подтверждено radix-ui/primitives, паттерн Shipfox
 * `[data-radix-popper-content-wrapper]:has(> [data-state="closed"])`), а
 * тултипы используют ту же обёртку, сами на Esc не реагируют и слоем не
 * являются. Слепой запрос «есть ли обёртка» поэтому глотал Esc сразу после
 * закрытого меню и при наведённом тултипе — карточки «иногда не закрывались».
 * Гейт — только РЕАЛЬНО открытое не-тултипное содержимое (прямой ребёнок
 * обёртки с data-state="open").
 */
export function hasOpenPopperLayer(): boolean {
  const open = document.querySelectorAll(
    '[data-radix-popper-content-wrapper] > [data-state="open"]',
  );
  for (const el of open) {
    if (el.getAttribute('role') !== 'tooltip') return true;
  }
  return false;
}
