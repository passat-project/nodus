import { useState } from 'react';
import type { NumberContainerRef, NumberCount, NumberSeriesRule } from '@nodus/contracts';
import { errorMessages, ErrorCode, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '../../../../shared/api-client.js';
import { useNumberCounts, useSetNumberNext } from '../../api/numbering-api.js';
import { fill } from '../../lib/counter-rule.js';

const counter = ui.customFields.dialog.counter;

function refName(ref: NumberContainerRef): string {
  if (ref.hidden) return counter.countsHidden;
  return ref.deleted ? `${ref.name} (${counter.countsDeleted})` : ref.name;
}

/** Имя счёта: значения условий через « · » (сквозной — «Сквозная нумерация»),
 *  путь — у первого значения (папка в проекте). */
export function countTitle(containers: readonly NumberContainerRef[]): {
  name: string;
  path: string;
} {
  if (containers.length === 0) return { name: counter.countsCompany, path: '' };
  const first = containers[0]!;
  return {
    name: containers.map(refName).join(' · '),
    path: first.hidden ? '' : first.path.join(' › '),
  };
}

/** Правка «следующего номера» на месте — только вперёд. */
export function NextNumberEditor({
  nextValue,
  disabled,
  onSave,
  onCancel,
}: {
  nextValue: number;
  disabled: boolean;
  onSave: (nextValue: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(nextValue));
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Input
        type="number"
        min={nextValue}
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
          void onSave(next).then(onCancel, () => undefined);
        }}
      >
        {counter.countsSave}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {counter.countsCancel}
      </Button>
    </span>
  );
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
  const title = countTitle(count.containers);
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
        <NextNumberEditor
          nextValue={count.nextValue}
          disabled={disabled}
          onSave={onSave}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={counter.countsEdit}
          title={counter.countsEdit}
          onClick={() => setEditing(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring/40 disabled:opacity-50"
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

/** Сохранить «следующий номер» счёта с понятной ошибкой «только вперёд». */
export function useSaveNext(definitionId: string) {
  const setNext = useSetNumberNext(definitionId);
  async function save(containerIds: string[], nextValue: number) {
    try {
      await setNext.mutateAsync({ containerIds, nextValue });
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
  return { save, pending: setNext.isPending };
}

/**
 * «Текущие счета» сохранённого счётчика (#630, модель v3): реальные папки,
 * проекты и портфели по именам (несколько условий — через « · ») — где
 * сколько выдано и какой номер следующий. «Следующий номер» правится
 * только вперёд (продолжение из Excel/с бумаги); для записи, у которой
 * счёта ещё нет, — через «Проверку на записи» выше.
 */
export function CounterCounts({
  definitionId,
  rule,
  disabled,
}: {
  definitionId: string;
  rule: NumberSeriesRule;
  disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const counts = useNumberCounts(definitionId, q.trim());
  const { save, pending } = useSaveNext(definitionId);
  const data = counts.data;

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
              key={`${count.containers.map((ref) => ref.id).join('|')}|${count.periodKey}`}
              count={count}
              disabled={disabled || pending}
              onSave={(nextValue) =>
                save(
                  count.containers.map((ref) => ref.id),
                  nextValue,
                )
              }
            />
          ))}
        </ul>
      )}
      {rule.containers.length > 0 ? (
        <span className="text-xs text-muted-foreground">{counter.countsAddHint}</span>
      ) : null}
    </section>
  );
}
