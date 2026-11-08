import { useState } from 'react';
import type { NumberCount } from '@nodus/contracts';
import { errorMessages, ErrorCode, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '../../../../shared/api-client.js';
import { useNumberCounts, useSetNumberNext } from '../../api/numbering-api.js';
import { fill } from '../../lib/counter-rule.js';

const counter = ui.customFields.dialog.counter;

function containerTitle(count: NumberCount): { name: string; path: string } {
  if (!count.container) return { name: counter.countsCompany, path: '' };
  if (count.container.hidden) return { name: counter.countsHidden, path: '' };
  const name = count.container.deleted
    ? `${count.container.name} (${counter.countsDeleted})`
    : count.container.name;
  return { name, path: count.container.path.join(' › ') };
}

function CountRow({
  count,
  disabled,
  onSave,
}: {
  count: NumberCount;
  disabled: boolean;
  onSave: (nextValue: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(count.nextValue));
  const title = containerTitle(count);
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">
          {title.name}
          {count.periodKey ? (
            <span className="text-muted-foreground"> · {count.periodKey}</span>
          ) : null}
        </span>
        {title.path ? (
          <span className="truncate text-xs text-muted-foreground">{title.path}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {count.lastDisplay
          ? fill(counter.countsLast, { number: count.lastDisplay })
          : counter.countsNoneYet}
      </span>
      {editing ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <Input
            type="number"
            min={count.nextValue}
            value={value}
            aria-label={counter.countsEdit}
            onChange={(event) => setValue(event.target.value)}
            className="h-7 w-24 text-sm tabular-nums"
          />
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const next = Math.trunc(Number(value));
              if (!Number.isFinite(next) || next < 1) return;
              void onSave(next).then(() => setEditing(false));
            }}
          >
            {counter.countsSave}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {counter.countsCancel}
          </Button>
        </span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={counter.countsEdit}
          title={counter.countsEdit}
          onClick={() => {
            setValue(String(count.nextValue));
            setEditing(true);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
        >
          <span className="text-muted-foreground">
            {fill(counter.countsNext, { number: '' }).trim()}
          </span>
          <span className="font-mono text-sm font-medium tabular-nums">{count.nextDisplay}</span>
          <Pencil className="size-3 text-muted-foreground" strokeWidth={1.75} />
        </button>
      )}
    </li>
  );
}

/**
 * «Текущие счета» сохранённого счётчика (#630): реальные папки, проекты и
 * портфели по именам — где сколько выдано и какой номер следующий.
 * «Следующий номер» правится только вперёд (продолжение из Excel/с бумаги).
 */
export function CounterCounts({
  definitionId,
  disabled,
}: {
  definitionId: string;
  disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const counts = useNumberCounts(definitionId, q.trim());
  const setNext = useSetNumberNext(definitionId);
  const data = counts.data;

  async function save(count: NumberCount, nextValue: number) {
    try {
      await setNext.mutateAsync({ containerId: count.container?.id ?? null, nextValue });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      toast.error(
        code === ErrorCode.NUMBER_NEXT_BACKWARDS
          ? errorMessages[ErrorCode.NUMBER_NEXT_BACKWARDS]
          : ui.customFields.dialog.saveError,
      );
      throw error;
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-muted-foreground">{counter.counts}</span>
        {data ? (
          <span className="text-xs text-muted-foreground">
            {fill(counter.countsTotals, {
              counts: String(data.totals.counts),
              issued: String(data.totals.issued),
            })}
          </span>
        ) : null}
      </div>
      {data && (data.totals.counts > 5 || q) ? (
        <Input
          value={q}
          placeholder={counter.countsSearch}
          aria-label={counter.countsSearch}
          onChange={(event) => setQ(event.target.value)}
          className="h-8 text-sm"
        />
      ) : null}
      {data && data.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{counter.countsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 rounded-lg border border-input p-1">
          {(data?.items ?? []).map((count) => (
            <CountRow
              key={`${count.container?.id ?? 'company'}|${count.periodKey}`}
              count={count}
              disabled={disabled || setNext.isPending}
              onSave={(nextValue) => save(count, nextValue)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
