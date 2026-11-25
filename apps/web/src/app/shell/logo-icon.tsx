/** Иконка продукта Nodus: гексагональный узел с тремя балками (мастер docs/design/logo/Nodus_иконка.svg).
 *  viewBox = ПЛОТНЫЕ границы контента (с запасом на штрих 1.5): знак 7.15…56.85
 *  × 5…49.25 (центр 32, 27.125) → квадрат 52.7 с центром (32, 27.125). Без
 *  плотной рамки пустое поле мастера (64 юнита) съедало высоту знака — он
 *  читался на треть меньше соседних значков (#1038, владелец 25.11). */
export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="5.65 0.775 52.7 52.7" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth={3} fill="none" strokeLinecap="round">
        <line x1="32" y1="22.5" x2="32" y2="13" />
        <line x1="22.91" y1="38.25" x2="14.68" y2="43" />
        <line x1="41.09" y1="38.25" x2="49.32" y2="43" />
        <polygon points="32,26 38.06,29.5 38.06,36.5 32,40 25.94,36.5 25.94,29.5" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="9.5" r="4.5" />
        <circle cx="11.65" cy="44.75" r="4.5" />
        <circle cx="52.35" cy="44.75" r="4.5" />
      </g>
    </svg>
  );
}
