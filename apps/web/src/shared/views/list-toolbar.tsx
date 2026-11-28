import { Search, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { FilterPanel, type FilterPanelExt } from './filter-panel.js';
import { filterValueLabel, isActiveFilter, type FilterFieldDef } from './list-filters.js';
import type { FilterPreset, ListToolbarState } from './use-list-toolbar.js';

/**
 * Тихая сводка состояния списка в правом слоте строки инструментов
 * («Включено: 3 из 7», «Все типы · 9»; ревизия UI v3, #857): данные —
 * приглушённым текстом с табличными цифрами, без плашек; массовые команды
 * списков без выделения строк стоят рядом с ней тихими ghost-кнопками.
 * Кегль — метки 13px (`text-xs`), а не тело 15px: сводка — служебная строка
 * рядом с действиями и не должна спорить с текстом поиска (раньше была
 * крупнее заголовков колонок).
 */
export function ListToolbarSummary({ children }: { children: ReactNode }) {
  // В тесной зоне (контейнер `@container` — обёртка списка, уже 620px) сводка
  // уходит: главная кнопка, поиск и шестерёнка вида важнее, а сводку не
  // выталкивала шестерёнку за край рамы на 1280 с развёрнутым меню.
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums @max-[620px]:hidden">
      {children}
    </span>
  );
}

/**
 * Строка инструментов списка — ЕДИНЫЙ стандарт всех журналов и вкладок-списков
 * («модули не отличаются», вердикт владельца 2026-09-11). Модель Битрикс24:
 * ОДНА поисковая строка (placeholder — короткий «Поиск…»), при фокусе она
 * РАСШИРЯЕТСЯ и из неё выезжает панель фильтра (отдельной кнопки «Фильтр»
 * НЕТ): слева пресеты (быстрое применение, «скрепка» по умолчанию), справа
 * поля по атрибутам. Активные фильтры — съёмными чипами в строке.
 * ЗАКОН КНОПКИ СОЗДАНИЯ (вердикт владельца 15.09.2026): кнопка создания
 * сущности модуля — ПЕРВЫЙ элемент строки инструментов, СЛЕВА от поисковой
 * строки (слот `left`), во ВСЕХ модулях одинаково — И ВО ВКЛАДКАХ-СПИСКАХ
 * карточек (та же строка инструментов); label — всегда «Создать»
 * (ui.common.create, БЕЗ уточнения сущности — кнопка не раздувается по
 * ширине), высота = высоте поисковой строки (h-8, Button size default);
 * в виде без поиска — сразу после заголовка (та же левая позиция).
 * Слот `right` — счётчики/шестерёнка полей.
 * Глобальный «Умный поиск» портала — лупа в топбаре, не конкурирует.
 */
export function ListToolbar<T>({
  toolbar,
  defs,
  builtinPresets = [],
  left,
  right,
  className,
  hiddenChips = [],
  searchPlaceholder = ui.common.searchPlaceholder,
  ext,
}: {
  toolbar: ListToolbarState;
  defs: FilterFieldDef<T>[];
  builtinPresets?: FilterPreset[];
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** Id фильтров, чьё значение показывает другой контрол (напр. «Портфели»
   *  на своей кнопке) — чип в поиске такому фильтру не нужен. */
  hiddenChips?: readonly string[];
  /** Подсказка поиска — по полям серверного поиска сущности (I15: строка из i18n). */
  searchPlaceholder?: string;
  /** Расширение панели #435 (группировка/итоги/виды/CSV); без него — прежняя
   *  панель, журналы без расширения не меняются. */
  ext?: FilterPanelExt;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  // Gotcha (docs/gotchas/frontend.md «Radix Popover из фокуса»): открывать панель
  // НА onFocus нельзя — focus приходит на mousedown, слой DismissableLayer
  // монтируется между pointerdown и click, и завершающий click той же
  // мыши дисмиссит панель как «взаимодействие снаружи» (вспышка+закрытие).
  // Канон: мышь — открывает onClick (слой монтируется ПОСЛЕ события),
  // клавиатура (Tab/программный focus) — onFocus без указательного флага.
  const fromPointer = useRef(false);
  // Зеркальный симметричный случай: панель уже открыта, повторный клик по
  // якорю — pointerdown-outside дисмиссит её, а запланированный дисмисс
  // добивает ПОСЛЕ нашего onClick (инверсия бэтчинга). Лечение канонично —
  // onInteractOutside + preventDefault для целей внутри якоря (как Radix
  // сам делает для триггера).
  const anchorRef = useRef<HTMLDivElement>(null);
  const activeDefs = defs.filter(
    (d) => !hiddenChips.includes(d.id) && isActiveFilter(toolbar.filters[d.id]),
  );
  // Панель фильтра открывается, только когда фильтровать есть чем: у списка
  // без полей и пресетов (справочник контрагентов — поиск и архивные
  // серверные, #460) пустая панель была бы мусором под строкой поиска.
  // #435: расширение (группировка/итоги/виды/CSV) — тоже причина панели.
  const hasPanel =
    defs.some((d) => !d.hidden) ||
    builtinPresets.length > 0 ||
    toolbar.presets.length > 0 ||
    ext !== undefined;

  return (
    <div className={cn('flex h-10 shrink-0 items-center gap-2 px-4', className)}>
      {left}
      <Popover open={hasPanel && panelOpen} onOpenChange={setPanelOpen}>
        <PopoverAnchor asChild>
          {/* Поисковая строка — композитный контрол (модель Битрикс24):
              применённые фильтры — ЧИПАМИ ВНУТРИ поля слева, текст запроса —
              после них; в фокусе (панель открыта) поле РАСШИРЯЕТСЯ ДО ШИРИНЫ
              панели фильтра */}
          <div
            ref={anchorRef}
            className={cn(
              // Сжимается (до min-w-56), а не выталкивает слот `right` за край
              // рамы, когда шапка тесная (переключатель сущности, #431).
              'relative min-w-56 shrink transition-[width] duration-200',
              panelOpen ? 'w-[min(36rem,calc(100vw-3rem))]' : 'w-[28rem]',
            )}
          >
            <div
              className={cn(
                'flex h-8 w-full min-w-0 items-center gap-1 rounded-lg border border-input bg-transparent pr-1 pl-2 transition-colors dark:bg-input/30',
                'focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30',
              )}
            >
              <Search className="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
              {/* Чипы активных фильтров — ВНУТРИ поля (модель Битрикс24);
                  суммарно ≤ 80% ширины поля (вердикт владельца), значение —
                  с truncate, остальное место — тексту запроса */}
              <div className="flex max-w-[80%] shrink-0 items-center gap-1 overflow-hidden">
                {activeDefs.map((def) => (
                  <span
                    key={def.id}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs whitespace-nowrap text-foreground"
                  >
                    <span
                      className="max-w-40 truncate"
                      title={`${def.label}: ${filterValueLabel(def, toolbar.filters[def.id])}`}
                    >
                      {def.label}: {filterValueLabel(def, toolbar.filters[def.id])}
                    </span>
                    <button
                      type="button"
                      onClick={() => toolbar.setFilter(def.id, undefined)}
                      aria-label={`${ui.filters.reset}: ${def.label}`}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </button>
                  </span>
                ))}
              </div>
              <input
                value={toolbar.query}
                onChange={(e) => toolbar.setQuery(e.target.value)}
                onPointerDown={() => {
                  fromPointer.current = true;
                }}
                onFocus={() => {
                  if (!fromPointer.current && hasPanel) setPanelOpen(true);
                }}
                onClick={() => {
                  fromPointer.current = false;
                  if (hasPanel) setPanelOpen(true);
                }}
                placeholder={searchPlaceholder}
                aria-label={ui.common.search}
                className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
              />
              {toolbar.query ? (
                <button
                  type="button"
                  onClick={() => toolbar.setQuery('')}
                  aria-label={ui.filters.reset}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(36rem,calc(100vw-2rem))] overflow-hidden p-0"
          // Фокус остаётся в поисковой строке: печатать можно сразу (Битрикс).
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Клик по якорю (само поле) — НЕ «взаимодействие снаружи»
          // (защита триггера, как внутри Radix для Trigger).
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <FilterPanel toolbar={toolbar} defs={defs} builtinPresets={builtinPresets} ext={ext} />
        </PopoverContent>
      </Popover>
      {right ? <div className="ml-auto flex shrink-0 items-center gap-1">{right}</div> : null}
    </div>
  );
}
