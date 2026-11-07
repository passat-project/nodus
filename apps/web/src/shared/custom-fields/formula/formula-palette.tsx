import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { FormulaAggregate } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import type { SourceGroup, SourceLeaf, SourceNode } from './formula-sources.js';

function matches(label: string, query: string): boolean {
  return query.length === 0 || label.toLowerCase().includes(query.toLowerCase());
}

/** Заголовок группы палитры: плотный вариант NodeLabel (11px semibold
 *  uppercase, трекинг 0.08em) — дерево источника читается секциями, но не
 *  спорит с пунктами по весу. */
const GROUP_CLASS =
  'px-2 pt-2.5 pb-1 text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase';

/**
 * Дерево источников редактора формул: раскрытие ветвей, поиск по подписям,
 * вставка плашки. Плотность — строки 13px с шагом 1.5; недоступный источник
 * (нет родителя/проекта/ссылок) — ПОЯСНЕНИЕ без шеврона: пункт, который
 * ничего не раскрывает, не должен выглядеть раскрывающимся.
 */
export function FormulaPalette({
  groups,
  onInsertField,
  onInsertAggregate,
}: {
  groups: readonly SourceGroup[];
  onInsertField: (leaf: SourceLeaf) => void;
  onInsertAggregate: (aggregate: FormulaAggregate) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const filtered = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              matches(item.label, query) ||
              item.children?.some((child) => matches(child.label, query)) ||
              item.leaf !== undefined,
          ),
        }))
        .filter((group) => group.items.length > 0),
    [groups, query],
  );

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderItem = (item: SourceNode, depth: number) => {
    const indent = depth > 0 ? 'pl-6' : undefined;
    if (item.leaf) {
      return (
        <button
          key={item.key}
          type="button"
          // mousedown уводит фокус и схлопывает каретку — плашка вставилась бы
          // в конец строки вместо позиции курсора.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsertField(item.leaf!)}
          className={cn(
            'flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
            indent,
          )}
        >
          <span className="truncate">{item.label}</span>
        </button>
      );
    }
    if (item.aggregate) {
      // Агрегат — не просто поле: «Σ» помечает выборку, которая откроет
      // диалог. Тон акцента — тот же, что у плашки агрегата в строке.
      return (
        <button
          key={item.key}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsertAggregate(item.aggregate!)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
            indent,
          )}
        >
          <span className="truncate">{item.label}</span>
          <span
            aria-hidden
            className="ml-auto shrink-0 font-mono text-label-xs leading-none text-primary/70"
          >
            Σ
          </span>
        </button>
      );
    }
    if (!item.children?.length || item.disabledHint) {
      // Тупик источника — пояснение в одну-две строки, без шеврона.
      return (
        <p
          key={item.key}
          title={item.disabledHint}
          className={cn('px-2 py-1 text-xs break-words text-muted-foreground/80', indent)}
        >
          {item.label}
        </p>
      );
    }
    const open = expanded.has(item.key);
    return (
      <div key={item.key}>
        <button
          type="button"
          onClick={() => toggle(item.key)}
          className={cn(
            'flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
            indent,
          )}
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
            strokeWidth={2}
          />
          <span className="truncate">{item.label}</span>
        </button>
        {open && item.children ? (
          <div className="flex flex-col">
            {item.children.map((child) => renderItem(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 p-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ui.formulas.editor.searchSources}
          aria-label={ui.formulas.editor.searchSources}
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {ui.formulas.editor.emptySources}
          </p>
        ) : (
          filtered.map((group) => (
            <section key={group.key}>
              <p className={GROUP_CLASS}>{group.label}</p>
              {group.items.map((item) => renderItem(item, 0))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
