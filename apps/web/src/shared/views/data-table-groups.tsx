import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import type { ListGroupBucket, ListTotal, ListTotalValue } from '@nodus/contracts';
import { formatTotalValue } from './list-ext/list-grouping.js';

/**
 * Заголовки групп и строка итогов таблицы (#435): грамматика секций
 * существующих списков — моно-заголовок NodeLabel-кеглем со счётчиком
 * tabular-nums (как сводка строки инструментов), сворачивание шевроном (как
 * ветки дерева журнала задач); строка итогов — тихая строка с табличными
 * цифрами внизу таблицы. Счётчики и суммы считает сервер (ListResult).
 */

/** Заголовок группы: имя поля-значения, счётчик, итоги группы. */
export function GroupHeaderRow({
  label,
  group,
  totalsDefs,
  collapsed,
  onToggle,
}: {
  label: string;
  group: ListGroupBucket | undefined;
  /** Описания итогов (подписи fn) в том же порядке. */
  totalsDefs: readonly ListTotal[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const count = group?.count;
  return (
    <div
      role="row"
      className="sticky top-10 z-[5] flex h-12 w-max min-w-full items-center gap-2 border-b border-border/60 bg-muted px-4"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={label}
        className="flex min-w-0 items-center gap-1.5 text-left"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            !collapsed && 'rotate-90',
          )}
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </span>
      </button>
      {count !== undefined ? (
        <span className="shrink-0 font-mono text-label-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
      {group ? (
        <span className="ml-auto flex shrink-0 items-center gap-2 overflow-hidden">
          {group.totals.map((total, i) => (
            <span
              key={`${total.fn}-${defField(totalsDefs[i])}`}
              className="font-mono text-label-xs whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {fnLabel(totalsDefs[i])} {formatTotalValue(total.value)}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** Подпись агрегата итога (I15 — словарь, не fn-имя). */
function fnLabel(total: ListTotal | undefined): string {
  const t = ui.lists.panel;
  if (!total) return '';
  switch (total.fn) {
    case 'count':
      return t.totalCount;
    case 'sum':
      return t.sum;
    case 'min':
      return t.min;
    case 'max':
      return t.max;
  }
}

/** Ключ итога (у count поля нет). */
function defField(total: ListTotal | undefined): string {
  return total && total.fn !== 'count' ? total.field : '';
}

/** Строка итогов внизу таблицы: тихие цифры по всей видимой выборке. */
export function TotalsRow({
  totals,
  totalsDefs,
}: {
  totals: readonly ListTotalValue[];
  totalsDefs: readonly ListTotal[];
}) {
  if (totals.length === 0) return null;
  return (
    <div
      role="row"
      className="sticky bottom-0 z-[5] flex h-12 w-max min-w-full items-center gap-3 border-t border-border bg-card px-4"
    >
      <span className="shrink-0 text-label-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {ui.lists.panel.totalsRow}
      </span>
      <span className="flex min-w-0 items-center gap-3 overflow-hidden">
        {totals.map((total, i) => (
          <span
            key={`${total.fn}-${defField(totalsDefs[i]) || i}`}
            className="font-mono text-label-xs whitespace-nowrap text-foreground tabular-nums"
          >
            {fnLabel(totalsDefs[i])}: {formatTotalValue(total.value)}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Сворачиваемость групп: множество закрытых ключей (стабильный ключ —
 *  приведённое значение, null — «без значения»). */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string | number | null) => {
    const id = key === null ? '\u0000' : `${typeof key}:${key}`;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isCollapsed = (key: string | number | null) =>
    collapsed.has(key === null ? '\u0000' : `${typeof key}:${key}`);
  return { isCollapsed, toggle };
}
