import { useRef } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ViewSort } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { ColumnResizer } from './column-resizer.js';
import type { FieldDef, ViewField } from './use-view-fields.js';
import { uiPx } from '../ui/ui-scale.js';

/** Поле хедера: структурный минимум (render ячейки хедеру не нужен) —
 *  подходят и DataTableField, и реестр дерева-графа журнала задач. */
type HeaderField = ViewField<FieldDef> & { sortValue?: unknown };

/** Порог отличия клика (сортировка) от начала перетаскивания, px. */
const DRAG_THRESHOLD = 6;

/**
 * Хедер канонической таблицы (вынесен из data-table, I5): «выбрать все» +
 * колонки с ТРЕМЯ жестами, не конфликтующими между собой (концепт #4):
 * — ПОРЯДОК (модель Битрикс24, вердикт владельца 15.09.2026): заголовок И
 *   ДАННЫЕ колонки едут ВМЕСТЕ 1:1 за курсором, строго по ГОРИЗОНТАЛИ;
 *   соседние разъезжаются трансформами, показывая место посадки; порядок
 *   фиксируется ОДИН раз на отпускании. Реализация — ручной pointer-drag
 *   с императивными translateX (БЕЗ перерисовок React покадрово: урок
 *   лагов первой версии — dnd-kit с arrayMove на каждое движение мыши
 *   пересоздавал всю таблицу; gotchas). Ресайз-ручка глушит pointerdown.
 * — СОРТИРОВКА: клик без движения (< 6px) по сортируемому полю — цикл ↑/↓
 *   (одна колонка, стрелка у лейбла), клавиатурно — Enter/Space, aria-sort.
 */
export function DataTableHeader({
  fields,
  sort,
  headerChecked,
  hasActions,
  style,
  afterLeading,
  showSelection = true,
  onToggleAll,
  onResize,
  onAutoFit,
  onCycleSort,
  onReorder,
}: {
  fields: HeaderField[];
  sort?: ViewSort;
  headerChecked: boolean | 'indeterminate';
  hasActions: boolean;
  /** gridTemplateColumns — общий трек с строками (ведущая + px-колонки). */
  style: { gridTemplateColumns: string };
  /** Слот между ведущей колонкой и полями (спейсер колонки графа дерева). */
  afterLeading?: ReactNode;
  /** Показывать «выбрать все»: в read-only режиме ведущая ячейка пустая
   *  (структура архивного проекта — только просмотр). */
  showSelection?: boolean;
  onToggleAll: () => void;
  onResize: (fieldId: string, width: number) => void;
  onAutoFit: (fieldIndex: number, fieldId: string, minWidth: number, maxWidth: number) => void;
  onCycleSort: (fieldId: string) => void;
  /** Коммит порядка на отпускании: ПОЛНЫЙ порядок видимых полей. */
  onReorder: (ids: string[]) => void;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  // Состояние живого перетаскивания (ref — перерисовок во время drag нет).
  const drag = useRef<{
    fieldId: string;
    fromIndex: number;
    startX: number;
    startLeft: number;
    width: number;
    active: boolean;
    lastDx: number;
    lastClientX: number;
    /** Текущий проецируемый слот (индекс БЕЗ активной), с гистерезисом. */
    landing: number;
  } | null>(null);

  /** Колонка поля: хедер-ячейка + все ячейки данных (скролл-контейнер таблицы). */
  function columnEls(fieldId: string): HTMLElement[] {
    const scope = headerRef.current?.parentElement;
    if (!scope) return [];
    return [
      ...scope.querySelectorAll<HTMLElement>(
        `[data-header-field="${fieldId}"], [data-cell-field="${fieldId}"]`,
      ),
    ];
  }

  /** Шаг посадки — курсор против ТЕКУЩИХ (сдвинутых) середин соседей
   *  (механика AG Grid `calculateValidMoves`+`constrainDirection`, research
   *  исходников; финальные вердикты владельца 15.09.2026): сдвиг соседа
   *  считается от ПРОШЛОЙ посадки, поэтому после открытия слота обратный
   *  порог уезжает на ВСЮ ширину перетаскиваемой колонки — АДАПТИВНЫЙ
   *  гистерезис без констант: широкую колонку вернуть можно только
   *  сильным обратным ходом (сотни px, «зазор большой» — вердикт), узкую —
   *  компактным; мёртвая зона = ширине активной, поэтому состояние у порога
   *  самоустойчиво (после флипа курсор глубоко внутри зоны — осцилляции
   *  нет). Дальность первичного хода — середина цели; пороги по статичному
   *  layout + известному сдвигу (offsetLeft игнорирует трансформы,
   *  перелayout во время drag нет). Отвергнуты владельцем: центр-на-центр,
   *  край трека, край данных, фиксированный гистерезис 20px. */
  function updateLanding(d: NonNullable<typeof drag.current>, clientX: number) {
    const headerEl = headerRef.current;
    if (!headerEl) return;
    const pointerX = clientX - headerEl.getBoundingClientRect().left;
    const cells = [...headerEl.querySelectorAll<HTMLElement>('[data-header-field]')];
    let landing = 0;
    for (const c of cells) {
      const id = c.dataset.headerField;
      if (!id || id === d.fieldId) continue;
      const j = fields.findIndex((f) => f.id === id);
      if (j < 0) continue;
      const shortenedJ = j > d.fromIndex ? j - 1 : j;
      // Текущий сдвиг соседа — от ПРОШЛОЙ посадки (та же формула, что в
      // разъезде ниже): пройденная вправо колонка уже уехала на −width.
      const shift =
        shortenedJ >= d.landing && j < d.fromIndex
          ? d.width
          : shortenedJ < d.landing && j > d.fromIndex
            ? -d.width
            : 0;
      if (c.offsetLeft + shift + c.offsetWidth / 2 < pointerX) landing++;
    }
    d.landing = landing;
  }

  function setColTransform(fieldId: string, dx: number, isActive: boolean) {
    for (const el of columnEls(fieldId)) {
      el.style.transform = dx === 0 && !isActive ? '' : `translate3d(${dx}px, 0, 0)`;
      if (isActive) el.setAttribute('data-dragging-col', '');
      else el.removeAttribute('data-dragging-col');
    }
  }

  function onHeaderPointerDown(
    e: React.PointerEvent<HTMLSpanElement>,
    field: HeaderField,
    index: number,
  ) {
    if (e.button !== 0) return;
    const headerEl = headerRef.current;
    if (!headerEl) return;
    const startX = e.clientX;
    drag.current = {
      fieldId: field.id,
      fromIndex: index,
      startX,
      startLeft: (e.currentTarget as HTMLElement).offsetLeft,
      width: (e.currentTarget as HTMLElement).offsetWidth,
      active: false,
      lastDx: 0,
      lastClientX: startX,
      landing: index,
    };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - startX;
      if (!d.active) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        d.active = true;
        headerEl.parentElement?.classList.add('nodus-coldrag');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      d.lastDx = dx;
      d.lastClientX = ev.clientX;
      // Активная колонка — 1:1 за курсором (только X).
      setColTransform(d.fieldId, dx, true);
      // Посадка — шаг с гистерезисом; соседи разъезжаются под слот.
      updateLanding(d, ev.clientX);
      const landing = d.landing;
      const cells = [...headerEl.querySelectorAll<HTMLElement>('[data-header-field]')];
      for (const c of cells) {
        const id = c.dataset.headerField;
        if (!id || id === d.fieldId) continue;
        const j = fields.findIndex((f) => f.id === id);
        const shortenedJ = j > d.fromIndex ? j - 1 : j;
        const shift =
          shortenedJ >= landing && j < d.fromIndex
            ? d.width
            : shortenedJ < landing && j > d.fromIndex
              ? -d.width
              : 0;
        setColTransform(id, shift, false);
      }
    };

    const finish = (commit: boolean) => {
      const d = drag.current;
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const scope = headerEl.parentElement;
      scope?.classList.remove('nodus-coldrag');
      if (!d) return;
      if (!d.active) {
        // Клик без движения — сортировка.
        if (commit && field.sortValue !== undefined) onCycleSort(field.id);
        return;
      }
      if (commit) {
        // Посадка — проецируемый слот (с гистерезисом) на момент отпускания.
        const ids = fields.map((f) => f.id).filter((id) => id !== d.fieldId);
        ids.splice(d.landing, 0, d.fieldId);
        onReorder(ids);
      }
      // Трансформы снимаем ПОСЛЕ коммита React, до кадра — одна отрисовка.
      requestAnimationFrame(() => {
        for (const f of fields) setColTransform(f.id, 0, false);
      });
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  return (
    <div
      ref={headerRef}
      role="row"
      className="sticky top-0 z-10 grid w-max min-w-full items-center gap-3 border-b border-border bg-card px-4 py-2"
      style={style}
    >
      {/* Транзишены разъезда соседних колонок — только в живом drag;
          активная колонка без транзишена (1:1 за курсором). */}
      <style>{`
        .nodus-coldrag [data-header-field], .nodus-coldrag [data-cell-field] { transition: transform 160ms ease; }
        .nodus-coldrag [data-dragging-col] { transition: none; position: relative; z-index: 5; }
      `}</style>
      {/* «Выбрать все» (модель Битрикс24): indeterminate при частичном. */}
      <span role="columnheader" className="flex items-center">
        {showSelection ? (
          <Checkbox
            checked={headerChecked}
            onCheckedChange={onToggleAll}
            aria-label={ui.common.selectAll}
          />
        ) : null}
      </span>
      {afterLeading ?? null}
      {fields.map((field, index) => {
        const sorted = sort?.field === field.id ? sort.dir : undefined;
        const sortable = field.sortValue !== undefined;
        return (
          // columnheader: единственная роль, где aria-sort валиден (аудит
          // #45 — был span role=button, невалидный ARIA). Клик/Enter —
          // сортировка, pointer-drag — порядок (data-table-header).
          <span
            key={field.id}
            data-header-field={field.id}
            role="columnheader"
            tabIndex={sortable ? 0 : undefined}
            aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
            // Атрибутная колонка (#632) сортировкой не обладает — подсказка
            // объясняет, почему клик по заголовку ничего не меняет.
            title={!sortable && field.group === 'attributes' ? ui.formulas.views.noSort : undefined}
            onPointerDown={(e) => onHeaderPointerDown(e, field, index)}
            onKeyDown={
              sortable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onCycleSort(field.id);
                    }
                  }
                : undefined
            }
            className={cn(
              'relative flex min-w-0 cursor-grab items-center gap-1 select-none',
              sortable && 'hover:text-foreground',
            )}
          >
            <NodeLabel label={field.label} className="truncate" />
            {sorted === 'asc' ? <ArrowUp className="size-3 shrink-0 text-foreground" /> : null}
            {sorted === 'desc' ? <ArrowDown className="size-3 shrink-0 text-foreground" /> : null}
            {field.width !== undefined && index < fields.length - 1 ? (
              <ColumnResizer
                width={field.width}
                minWidth={uiPx(field.minWidth ?? 48)}
                maxWidth={uiPx(field.maxWidth ?? 640)}
                onResize={(w) => onResize(field.id, w)}
                onAutoFit={() =>
                  onAutoFit(
                    index,
                    field.id,
                    uiPx(field.minWidth ?? 48),
                    uiPx(field.maxWidth ?? 640),
                  )
                }
              />
            ) : null}
          </span>
        );
      })}
      {hasActions ? <span /> : null}
    </div>
  );
}
