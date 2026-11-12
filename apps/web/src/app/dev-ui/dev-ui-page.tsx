import { DevUiHeader } from './dev-ui-header.js';
import { ChipsSection } from './sections/chips-section.js';
import { ControlsSection } from './sections/controls-section.js';
import { OverlaysSection } from './sections/overlays-section.js';
import { StatesSection } from './sections/states-section.js';
import { TokensSection } from './sections/tokens-section.js';
import { TypographySection } from './sections/typography-section.js';

/**
 * Живая страница дизайн-системы (#257) — единственный dev-экран `/dev/ui`.
 * Собраны все примитивы `packages/ui`/`shared/ui` во всех состояниях и обеих
 * темах: приёмка канона «Инструмент» и валидация токенов по одной странице.
 *
 * Маршрут регистрируется ТОЛЬКО в dev-сборке (см. `app/router.tsx`): в прод-
 * бандле нет ни чанка страницы, ни её строк.
 *
 * Раскладка: шапка с тумблерами (фиксированная) → скролл-контейнер с секциями
 * (одна колонка, широкие экраны раскладывают группы в две). Каждая секция —
 * свой файл ≤ 300 строк (I5), подпись под контролом — имя класса/примитива.
 */
export function DevUiPage() {
  return (
    // min-w-0/max-w-full на корне — страховка шелла: широкий контент галереи
    // не должен становиться min-content всего приложения и отжимать левую
    // рейку (замечание владельца). Широкие блоки живут в своих
    // overflow-контейнерах внутри секций.
    <div className="relative flex h-full min-h-0 min-w-0 max-w-full flex-col">
      <DevUiHeader />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-10 p-6">
          <TokensSection />
          <TypographySection />
          <ControlsSection />
          <ChipsSection />
          <OverlaysSection />
          <StatesSection />
        </div>
      </div>
    </div>
  );
}
