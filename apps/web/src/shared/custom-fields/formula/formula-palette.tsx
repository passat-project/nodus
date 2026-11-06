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

/** Дерево источников: раскрытие ветвей, поиск по подписям, вставка плашки. */
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
    if (item.leaf) {
      return (
        <button
          key={item.key}
          type="button"
          onClick={() => onInsertField(item.leaf!)}
          className={cn(
            'flex w-full items-center rounded px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent',
            depth > 0 && 'pl-5',
          )}
        >
          <span className="truncate">{item.label}</span>
        </button>
      );
    }
    if (item.aggregate) {
      return (
        <button
          key={item.key}
          type="button"
          onClick={() => onInsertAggregate(item.aggregate!)}
          className={cn(
            'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs text-info/90 transition-colors hover:bg-accent',
            depth > 0 && 'pl-5',
          )}
        >
          <span className="truncate">{item.label}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Σ</span>
        </button>
      );
    }
    const open = expanded.has(item.key);
    return (
      <div key={item.key}>
        <button
          type="button"
          disabled={Boolean(item.disabledHint)}
          title={item.disabledHint}
          onClick={() => toggle(item.key)}
          className={cn(
            'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs transition-colors',
            item.disabledHint
              ? 'cursor-not-allowed text-muted-foreground/70'
              : 'text-foreground hover:bg-accent',
          )}
        >
          <ChevronRight
            className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
            strokeWidth={1.75}
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
      <div className="relative px-2 pb-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ui.formulas.editor.searchSources}
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {ui.formulas.editor.emptySources}
          </p>
        ) : (
          filtered.map((group) => (
            <section key={group.key} className="mb-2">
              <p className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.items.map((item) => renderItem(item, 0))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
