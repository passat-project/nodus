/**
 * Раскладка ширин видимых колонок журнала (#937). Колонка, ширину которой
 * человек не задавал, подбирается под содержимое (в пределах
 * `minWidth..maxWidth` реестра поля), а свободная ширина рабочей зоны
 * распределяется между такими колонками — пустой полосы справа и лишнего
 * горизонтального скролла нет. Колонка, которой ширину задали ручкой или
 * двойным кликом (в пресете вида есть `width`), остаётся ровно такой.
 *
 * Треки остаются px-ми (fr по-прежнему запрещён: резиновый трек
 * компенсирует дельту ресайза — ручка отрывается от курсора, gotchas);
 * разницу с шириной зоны считаем здесь, в JS, и раскладываем в те же px.
 */

export interface FitColumn {
  id: string;
  /** Ширину задал человек (пресет вида хранит width): раскладка не меняет. */
  locked: boolean;
  /** Базовая ширина — дефолт реестра или сохранённая человеком, px. */
  base: number;
  /** Измеренная ширина содержимого ячеек, px (воздух добавляет раскладка). */
  content: number;
  min: number;
  max: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Ширины колонок по id, целые px. `available` — ширина рабочей зоны под сами
 * колонки (служебные треки и зазоры вызывающий вычитает сам); `breathing` —
 * воздух сверх содержимого (COLUMN_BREATHING).
 */
export function fitColumnWidths(
  columns: readonly FitColumn[],
  available: number,
  breathing: number,
): Record<string, number> {
  const widths = new Map<string, number>();
  for (const column of columns) {
    const target = column.locked ? column.base : column.content + breathing;
    widths.set(column.id, Math.round(clamp(target, column.min, column.max)));
  }

  let free = Math.floor(available) - [...widths.values()].reduce((sum, w) => sum + w, 0);
  if (!Number.isFinite(free) || free <= 0) return Object.fromEntries(widths);

  // Сначала тянем колонки, которых человек не касался; ручные — если у тех
  // не осталось запаса до maxWidth (свою ширину человек уже выбрал сам).
  for (const locked of [false, true]) {
    if (free <= 0) break;
    free = grow(
      columns.filter((c) => c.locked === locked && (widths.get(c.id) ?? 0) < c.max),
      widths,
      free,
    );
  }
  return Object.fromEntries(widths);
}

/**
 * Раздаёт свободное место пропорционально запасу до `maxWidth` (широкая тема
 * письма забирает больше узкого номера) и возвращает остаток, который
 * раздать некуда: все кандидаты упёрлись в предел.
 */
function grow(columns: readonly FitColumn[], widths: Map<string, number>, free: number): number {
  let left = free;
  while (left > 0) {
    const candidates = columns.filter((c) => (widths.get(c.id) ?? 0) < c.max);
    if (candidates.length === 0) return left;
    const heads = candidates.map((c) => c.max - (widths.get(c.id) ?? 0));
    const headroom = heads.reduce((sum, head) => sum + head, 0);
    const share = Math.min(left, headroom);
    let given = 0;
    candidates.forEach((column, index) => {
      // floor: доли копятся в остатке и раздаются по одному px ниже.
      const growBy = Math.floor((share * heads[index]!) / headroom);
      if (growBy === 0) return;
      widths.set(column.id, (widths.get(column.id) ?? 0) + growBy);
      given += growBy;
    });
    let remainder = share - given;
    for (const column of candidates) {
      if (remainder <= 0) break;
      const width = widths.get(column.id) ?? 0;
      if (width >= column.max) continue;
      widths.set(column.id, width + 1);
      remainder -= 1;
    }
    const moved = share - remainder;
    if (moved === 0) return left;
    left -= moved;
  }
  return left;
}
