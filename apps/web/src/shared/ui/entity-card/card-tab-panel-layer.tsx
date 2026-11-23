import type { ReactNode } from 'react';
import { cn } from '@nodus/ui/lib/utils';

import { SurfaceVisibilityProvider } from '../../lib/surface-visibility.js';
import type { CardTabGroup, CardTabsState } from './card-tabs-model.js';
import type { CardTabDef } from './card-tab-strip.js';

/** id DOM-панели (вкладки могут содержать `:` — заменяем на `-`). */
export const domKey = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '-');

/**
 * Слой содержимого областей (#746): ВСЕ посещённые вкладки живут здесь в
 * стабильном порядке, активная панель каждой области позиционируется над
 * своей колонкой. Перенос вкладки меняет только left/width/visibility —
 * React не ремаунтит панель, скролл чата и зум PDF сохраняются.
 *
 * КОНТРАКТ панели вкладки: это полноразмерная flex-КОЛОНКА карточки
 * (absolute inset-y-0 = высота области + flex flex-col), поэтому контент
 * вкладки вправе быть `flex-1` или `h-full` и скроллиться внутри себя.
 * Блочная панель молча теряла flex-контекст: `flex-1` игнорировался, высота
 * колонки становилась высотой контента, `overflow-y-auto` не включался и
 * `overflow-hidden` панели срезал низ без возможности прокрутки (#798,
 * «О проекте» и вкладка «Чат» письма).
 */
export function CardTabPanelLayer({
  state,
  groups,
  tabs,
  widths,
  baseId,
  renderPanel,
}: {
  state: CardTabsState;
  groups: CardTabGroup[];
  tabs: CardTabDef[];
  widths: number[];
  /** Префикс id полос/панелей (один на карточку). */
  baseId: string;
  renderPanel: (tabId: string) => ReactNode;
}) {
  // Координаты КАЖДОЙ области (колонки карточки) и вкладка → её область.
  // Неактивная панель паркуется по координатам СВОЕЙ области, а не левой:
  // при переключении React в одном коммите переставляет панели, и браузер
  // успевал отрисовать перемещённый слой в чужой колонке на 130–170 мс
  // (тулбар прошлой вкладки мелькал в «О проекте», #959).
  const areaOf = new Map<string, { left: number; width: number; active: string }>();
  let offset = 0;
  groups.forEach((group, index) => {
    const area = { left: offset, width: widths[index] ?? 0, active: group.active };
    for (const tabId of group.tabs) areaOf.set(tabId, area);
    offset += area.width;
  });
  // Монтируем только ПОСЕЩЁННЫЕ вкладки: активные при создании состояния и
  // все, на которые пользователь переключался. Иначе открытие карточки
  // поднимало бы дерево/список/беседу/PDF всех вкладок сразу.
  const visited = new Set(Object.keys(state.visited));

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {tabs.map((tab) => {
        if (!visited.has(tab.id)) return null;
        const area = areaOf.get(tab.id);
        // Вкладка вне отрисованных областей (скрыта из личного набора, ещё не
        // разложена) остаётся СМОНТИРОВАННОЙ: панель паркуется в левой колонке
        // и невидима — скролл/зум/черновик живут (критерий #959). Мелькание
        // гасит `opacity: 0`, а не размонтирование.
        const active = area ? area.active === tab.id : false;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-tab-${domKey(tab.id)}-panel`}
            aria-labelledby={`${baseId}-tab-${domKey(tab.id)}-tab`}
            inert={!active}
            className={cn(
              // Контракт панели вкладки (см. шапку файла): полноразмерная
              // flex-колонка — иначе `flex-1`-контент вкладки не получает
              // высоту области и его скролл не включается (#798).
              'absolute inset-y-0 flex flex-col overflow-hidden',
              // `opacity: 0` — композиторное свойство: применяется сразу и
              // страхует от кадра перемещённого слоя; `invisible` оставлен
              // намеренно — он не отменяет IntersectionObserver (#770).
              !active && 'pointer-events-none invisible opacity-0',
            )}
            style={
              area ? { left: area.left, width: area.width } : { left: 0, width: widths[0] ?? 0 }
            }
          >
            {/* Неактивная вкладка остаётся СМОНТИРОВАННОЙ (скролл/зум живы),
                но `visibility:hidden` не отменяет IntersectionObserver и
                геометрию — её чат не должен читать и глушить попапы (#770,
                ADR-0038): панель — накрытая поверхность. */}
            <SurfaceVisibilityProvider visible={active}>
              {renderPanel(tab.id)}
            </SurfaceVisibilityProvider>
          </div>
        );
      })}
    </div>
  );
}
