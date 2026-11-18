import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

import { COLUMN_BREATHING, measureColumnContents } from './column-content.js';
import { fitColumnWidths } from './fit-columns.js';
import type { FieldDef, ViewField } from './use-view-fields.js';
import { uiPx } from '../ui/ui-scale.js';

/** Зазор сетки строки (`gap-3`) и боковые отступы строки (`px-4`), px. */
const GRID_GAP = uiPx(12);
const ROW_PADDING_X = uiPx(16) * 2;

/**
 * Ширины колонок журнала по содержимому и на всю рабочую зону (#937).
 *
 * Меряем один раз на смену набора видимых колонок, ширины рабочей зоны,
 * появление первых строк и загрузку шрифтов: при подгрузке следующих
 * страниц ширины не «прыгают» (двойной клик по ручке — по-прежнему ручной
 * автоподбор одной колонки). Колонки, которым ширину задал человек,
 * раскладка не трогает. Математика — чистый `fitColumnWidths`.
 *
 * Пока рабочая зона не измерена (первый кадр, jsdom) или строк ещё нет,
 * хук отдаёт пустой объект: таблица рисуется дефолтными ширинами реестра.
 */
export function useFittedColumnWidths<T extends FieldDef>({
  containerRef,
  fields,
  widthSet,
  fixedTracksPx,
  fixedTracksCount,
  hasActions = false,
  hasRows,
}: {
  containerRef: RefObject<HTMLElement | null>;
  /** Видимые поля реестра (в их порядке): ширина и пределы — оттуда. */
  fields: readonly ViewField<T>[];
  /** Id полей с шириной, заданной человеком (`prefs.width` пресета вида). */
  widthSet: ReadonlySet<string>;
  /** Сумма служебных треков слева от колонок (ведущая, граф), px. */
  fixedTracksPx: number;
  /** Сколько этих служебных треков — для счёта зазоров сетки. */
  fixedTracksCount: number;
  /** Есть трек действий справа (`auto`): его ширину вычитаем из зоны. */
  hasActions?: boolean;
  /** В журнале есть строки: мерить содержимое есть по чему. */
  hasRows: boolean;
}): Record<string, number> {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [zoneWidth, setZoneWidth] = useState(0);
  const [fontsSettled, setFontsSettled] = useState(false);

  // Ширина рабочей зоны: окно, рейка, панели карточки меняют её на лету.
  // Зависимость от `hasRows` — потому что контейнер появляется только вместе
  // с первой строкой (пустой журнал рисует Empty без таблицы).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setZoneWidth(container.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setZoneWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, hasRows]);

  // Метрики подменного шрифта отличаются от скачанного — пересчёт один раз.
  useLayoutEffect(() => {
    if (fontsSettled) return;
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return;
    let alive = true;
    void fonts.ready.then(() => {
      if (alive) setFontsSettled(true);
    });
    return () => {
      alive = false;
    };
  }, [fontsSettled]);

  const columns = useMemo(
    () =>
      fields.map((field) => ({
        id: field.id,
        locked: widthSet.has(field.id),
        base: field.width ?? uiPx(120),
        min: uiPx(field.minWidth ?? 48),
        max: uiPx(field.maxWidth ?? 640),
      })),
    [fields, widthSet],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || zoneWidth === 0 || !hasRows) return;
    const content = measureColumnContents(container);
    if (!content) return;
    const actionsPx = hasActions
      ? (container.querySelector<HTMLElement>('[data-actions-cell]')?.offsetWidth ?? 0)
      : 0;
    const tracks = fixedTracksCount + columns.length + (hasActions ? 1 : 0);
    const available =
      zoneWidth - ROW_PADDING_X - Math.max(0, tracks - 1) * GRID_GAP - fixedTracksPx - actionsPx;
    const next = fitColumnWidths(
      columns.map((column) => ({ ...column, content: content[column.id] ?? 0 })),
      available,
      COLUMN_BREATHING,
    );
    setWidths((prev) => (sameWidths(prev, next) ? prev : next));
  }, [
    columns,
    zoneWidth,
    hasRows,
    fontsSettled,
    hasActions,
    fixedTracksPx,
    fixedTracksCount,
    containerRef,
  ]);

  return widths;
}

/** Сравнение раскладок без лишнего setState (иначе — ре-рендер таблицы). */
function sameWidths(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  return keys.every((key) => a[key] === b[key]);
}
