import { uiPx } from '../ui/ui-scale.js';

/**
 * Замер содержимого колонок журнала (#937). Общий источник для автоподбора
 * двойным кликом (`use-autofit-column`) и авто-раскладки ширин
 * (`use-fitted-columns`): обе механики мерят ОДНО и то же — сумму
 * `scrollWidth` ДЕТЕЙ ячейки (scrollWidth самой ячейки не меньше её текущей
 * ширины и потому не подходит) плюс зазоры между детьми.
 */

/** Зазор между детьми ячейки (`gap-2` внутри ячейки), design-px. */
const CELL_CHILD_GAP = uiPx(8);

/** «Дыхание» колонки сверх ширины содержимого (воздух справа/слева). */
export const COLUMN_BREATHING = uiPx(24);

/** Место под ручку ресайза в правом краю хедера (она absolute, места не
 *  занимает, но текст не должен упираться в неё). */
const RESIZER_ROOM = uiPx(12);

/** Место под стрелку сортировки: она появляется по клику, а колонка не
 *  должна от этого обрезать свой заголовок. */
const SORT_ARROW_ROOM = uiPx(16);

/** Ширина содержимого набора элементов (flex-строка с зазорами). */
function contentWidth(children: readonly Element[]): number {
  let content = 0;
  for (const child of children) content += (child as HTMLElement).scrollWidth;
  return content + Math.max(0, children.length - 1) * CELL_CHILD_GAP;
}

/** Ширина содержимого ячейки, px. */
export function cellContentWidth(cell: HTMLElement): number {
  return contentWidth([...cell.children]);
}

/** Дети ячейки без ручки ресайза: её место считаем отдельной константой. */
function contentChildren(cell: HTMLElement): Element[] {
  return [...cell.children].filter((child) => child.getAttribute('role') !== 'separator');
}

/**
 * Максимум нужной ширины по колонкам (id поля → px): данные строк И
 * заголовок — верхний регистр заголовка шире значения ячейки, и обрезанное
 * «ДАТА РЕГИСТРАЦ…» над полной датой читалось багом.
 *
 * `null` — ячеек ещё нет (первый кадр/пустой журнал): раскладку трогать
 * нечем и незачем. `cellLimit` ограничивает проход: `scrollWidth` заставляет
 * браузер посчитать layout, а на тысячах строк это уже заметно — первых 3000
 * ячеек (обычно десятки строк) достаточно, колонка меряется по максимуму.
 */
export function measureColumnContents(
  container: HTMLElement,
  cellLimit = 3000,
): Record<string, number> | null {
  const cells = container.querySelectorAll<HTMLElement>('[data-cell-field]');
  if (cells.length === 0) return null;
  const contents: Record<string, number> = {};
  const remember = (id: string | undefined, width: number) => {
    if (id) contents[id] = Math.max(contents[id] ?? 0, width);
  };

  let seen = 0;
  for (const cell of cells) {
    remember(cell.dataset.cellField, contentWidth([...cell.children]));
    seen += 1;
    if (seen >= cellLimit) break;
  }

  for (const header of container.querySelectorAll<HTMLElement>('[data-header-field]')) {
    const room =
      (header.querySelector('[role="separator"]') ? RESIZER_ROOM : 0) +
      (header.tabIndex === 0 ? SORT_ARROW_ROOM : 0);
    remember(header.dataset.headerField, contentWidth(contentChildren(header)) + room);
  }
  return contents;
}
