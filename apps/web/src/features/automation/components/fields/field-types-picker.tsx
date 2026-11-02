import { useLayoutEffect, useRef, useState } from 'react';
import type { CustomFieldScope } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Check, ChevronDown, Minus, Search } from 'lucide-react';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { Separator } from '@nodus/ui/components/separator';
import { cn } from '@nodus/ui/lib/utils';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { nodeKindFormOf } from '@nodus/contracts';
import { useProcessTypes } from '../../api/automation-api.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';

/** С какого размера справочника в списке появляется строка поиска. */
const SEARCH_FROM = 7;
/** Место под плашку «+N» и зазор перед ней, px. */
const PLUS_RESERVE = 44;
/** Зазор между названиями в замере (gap-1), px. */
const NAME_GAP = 4;

/**
 * Сколько названий влезает в строку-сводку по РЕАЛЬНОЙ ширине: строка
 * заполняется целиком, «+N» — только на то, что не влезло. Замер — по
 * невидимому ряду всех названий; пересчёт на ресайз поля (ResizeObserver).
 */
function useFitCount(labels: readonly string[]) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(labels.length);
  const key = labels.join('\u0000');

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const recount = () => {
      const widths = Array.from(measure.children, (el) => (el as HTMLElement).offsetWidth);
      const width = box.clientWidth;
      const total = widths.reduce((sum, w, i) => sum + w + (i ? NAME_GAP : 0), 0);
      if (total <= width) return setCount(widths.length);
      let used = 0;
      let n = 0;
      for (const [i, w] of widths.entries()) {
        const next = used + w + (i ? NAME_GAP : 0);
        if (next + PLUS_RESERVE > width) break;
        used = next;
        n = i + 1;
      }
      setCount(n);
    };
    recount();
    const observer = new ResizeObserver(recount);
    observer.observe(box);
    return () => observer.disconnect();
  }, [key]);

  return { boxRef, measureRef, count };
}

/** Индикатор выбора — ведущий, у самого названия (Primer/Carbon: в
 *  мультивыборе отметка стоит В НАЧАЛЕ строки). Декоративный: кликается
 *  вся строка. Залитый квадрат не путается с контурными иконками типов. */
function Mark({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border transition-colors',
        state === 'off' ? 'border-input' : 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {state === 'on' ? <Check className="size-3" strokeWidth={2.5} /> : null}
      {state === 'some' ? <Minus className="size-3" strokeWidth={2.5} /> : null}
    </span>
  );
}

/**
 * Поле «Типы» окна атрибута (#432, В2): типы задач — для атрибутов задач,
 * типы писем — для писем (#55). У проектов и контрагентов типов процессов
 * нет — поля нет вовсе (атрибут действует на всех). Пусто — атрибут нигде
 * не показывается: карточка, форма, окна и условия видят только свои.
 *
 * Вид (концепт 26.10.2026, вариант B по best practices мультивыбора):
 * строка-сводка фиксированной высоты — названия заполняют её по замеру,
 * остаток уходит в «+N»; пустое
 * состояние сказано В САМОЙ строке (без текста под полем — окно не
 * дёргается); выбор — в поповере: «Выбрать все» с частичным состоянием,
 * ведущие отметки, выбранные сверху (порядок фиксируется в момент
 * открытия — строки не прыгают под курсором), поиск с SEARCH_FROM типов,
 * поповер не закрывается после клика.
 */
export function FieldTypesPicker({
  scope,
  typeIds,
  disabled,
  onChange,
}: {
  scope: CustomFieldScope;
  typeIds: readonly string[];
  disabled: boolean;
  onChange: (typeIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<readonly string[]>([]);
  const typed = scope === 'task' || scope === 'letter';
  const { data: types, isLoading, isError, refetch } = useProcessTypes();
  const options = (types ?? []).filter((type) => type.category === scope && !type.archivedAt);
  const selected = new Set(typeIds);
  const chosen = options.filter((type) => selected.has(type.id));
  const fit = useFitCount(chosen.map((type) => type.name));
  if (!typed) return null;

  const rank = (id: string) => {
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  const q = query.trim().toLowerCase();
  const visible = (q ? options.filter((type) => type.name.toLowerCase().includes(q)) : options)
    .slice()
    .sort((a, b) => rank(a.id) - rank(b.id));
  const allState = chosen.length === 0 ? 'off' : chosen.length === options.length ? 'on' : 'some';

  const toggle = (id: string) =>
    onChange(selected.has(id) ? typeIds.filter((x) => x !== id) : [...typeIds, id]);

  const empty = !isLoading && options.length > 0 && chosen.length === 0;
  const shown = chosen.slice(0, Math.max(1, fit.count));
  const rest = chosen.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{ui.customFields.bind.field}</span>
      {isError ? (
        <button
          type="button"
          onClick={() => void refetch()}
          className="flex h-8 items-center self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {ui.customFields.bind.error} — {ui.customFields.bind.retry}
        </button>
      ) : (
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (next) {
              setOrder([
                ...options.filter((t) => selected.has(t.id)).map((t) => t.id),
                ...options.filter((t) => !selected.has(t.id)).map((t) => t.id),
              ]);
            } else setQuery('');
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled || isLoading || options.length === 0}
              aria-label={ui.customFields.bind.field}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-lg border border-input px-2.5 text-left text-sm transition-colors outline-none',
                'hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30',
                'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
                open && 'border-ring',
              )}
            >
              <span ref={fit.boxRef} className="relative flex min-w-0 flex-1 items-center gap-2">
                {/* Невидимый замер всех названий — сколько влезет в строку. */}
                <span
                  ref={fit.measureRef}
                  aria-hidden
                  className="pointer-events-none invisible absolute top-0 left-0 flex gap-1 whitespace-nowrap"
                >
                  {chosen.map((type, i) => (
                    <span key={type.id}>
                      {type.name}
                      {i < chosen.length - 1 ? ',' : ''}
                    </span>
                  ))}
                </span>
                {chosen.length === 0 ? (
                  <span className="min-w-0 truncate text-muted-foreground">
                    {isLoading
                      ? ui.customFields.bind.loading
                      : options.length === 0
                        ? ui.customFields.bind.empty
                        : empty
                          ? ui.customFields.bind.nowhere
                          : null}
                  </span>
                ) : (
                  <span className="min-w-0 truncate whitespace-nowrap">
                    {shown.map((type) => type.name).join(', ')}
                  </span>
                )}
                {rest > 0 ? (
                  <span className="shrink-0 rounded-md bg-accent px-1.5 font-mono text-xs text-muted-foreground tabular-nums">
                    +{rest}
                  </span>
                ) : null}
              </span>
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex w-(--radix-popover-trigger-width) flex-col gap-0.5 p-1.5"
          >
            {options.length >= SEARCH_FROM ? (
              <div className="relative mb-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={ui.customFields.bind.search}
                  aria-label={ui.customFields.bind.search}
                  className="h-8 pl-8 text-sm"
                />
              </div>
            ) : null}
            {q ? null : (
              <>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allState === 'some' ? 'mixed' : allState === 'on'}
                  onClick={() => onChange(allState === 'on' ? [] : options.map((t) => t.id))}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-secondary-foreground transition-colors hover:bg-accent/60"
                >
                  <Mark state={allState} />
                  <span className="min-w-0 flex-1 truncate">{ui.customFields.bind.selectAll}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {chosen.length}/{options.length}
                  </span>
                </button>
                <Separator className="my-1" />
              </>
            )}
            <div
              role="listbox"
              aria-multiselectable
              aria-label={ui.customFields.bind.field}
              className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
            >
              {visible.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {ui.customFields.bind.notFound}
                </p>
              ) : (
                visible.map((type) => {
                  const on = selected.has(type.id);
                  return (
                    <button
                      key={type.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(type.id)}
                      className={cn(
                        'flex w-full shrink-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60',
                        on ? 'text-foreground' : 'text-secondary-foreground',
                      )}
                    >
                      <Mark state={on ? 'on' : 'off'} />
                      <ProcessTypeGlyph
                        icon={type.icon}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">{type.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Область «Папки» (#556): привязки «атрибут × вид» нет — виды добавляют
 *  атрибут в СВОЮ форму, поэтому в окне атрибута только сводка (чтение). */
export function NodeKindsSummary({ fieldId }: { fieldId?: string }) {
  const { data: kinds, isLoading } = useNodeKinds();
  const names = (kinds ?? [])
    .filter(
      (kind) =>
        fieldId !== undefined &&
        nodeKindFormOf(kind).fields.some((slot) => slot.fieldId === fieldId),
    )
    .map((kind) => kind.name);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{ui.customFields.bind.nodeColumn}</span>
      <span className="text-sm text-secondary-foreground">
        {isLoading ? '…' : names.length > 0 ? names.join(', ') : ui.customFields.bind.nodeNone}
      </span>
      <span className="text-xs break-words text-muted-foreground">
        {ui.customFields.bind.nodeHint}
      </span>
    </div>
  );
}
