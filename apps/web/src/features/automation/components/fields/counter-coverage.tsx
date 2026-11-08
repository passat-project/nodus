import type { NumberSeriesRule } from '@nodus/contracts';
import { numberSeriesRuleSchema, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { CircleAlert, CircleCheck } from 'lucide-react';

import { useNumberCoverage } from '../../api/numbering-api.js';
import { fill, type ContainerNames } from '../../lib/counter-rule.js';

const counter = ui.customFields.dialog.counter;

/**
 * Охват правила на реальных данных (#630): правила «какая папка внутри
 * какой» в системе нет, поэтому окно показывает факт — сколько уже
 * существующих записей отмеченных типов лежат внутри выбранного счёта и
 * какие номер не получат («Очередь» вне «Этапа»). Пересчёт — на каждую
 * правку черновика.
 */
export function CounterCoverage({
  rule,
  participantTypeIds,
  names,
}: {
  rule: NumberSeriesRule;
  participantTypeIds: readonly string[];
  names: ContainerNames;
}) {
  const ready = participantTypeIds.length > 0 && numberSeriesRuleSchema.safeParse(rule).success;
  const coverage = useNumberCoverage(
    ready ? { rule, participantTypeIds: [...participantTypeIds] } : null,
  );
  const data = coverage.data;
  if (!ready || !data) return null;
  const folder = rule.containers.find((entry) => entry.kind === 'folder');
  const field = rule.containers.find((entry) => entry.kind === 'field');
  const nameFor = (reason: string) =>
    reason === 'no_folder' && folder?.kind === 'folder'
      ? (names.nodeKind(folder.nodeKindId) ?? '')
      : reason === 'empty_field' && field?.kind === 'field'
        ? (names.field(field.fieldNumber) ?? '')
        : '';
  const values = { total: String(data.total), inside: String(data.inside) };
  if (data.total === 0) {
    return <p className="text-xs text-muted-foreground">{counter.coverageEmpty}</p>;
  }
  const ok = data.inside === data.total;
  return (
    <div className="flex flex-col gap-1">
      <p
        className={cn(
          'flex items-start gap-1.5 text-xs',
          ok ? 'text-muted-foreground' : data.inside === 0 ? 'text-danger' : 'text-warning',
        )}
      >
        {ok ? (
          <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" strokeWidth={1.75} />
        ) : (
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
        )}
        <span>
          {fill(
            ok
              ? counter.coverageAll
              : data.inside === 0
                ? counter.coverageNone
                : counter.coveragePart,
            values,
          )}
        </span>
      </p>
      {!ok ? (
        <ul className="flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
          {data.outside.map((entry) => (
            <li key={entry.id} className="truncate">
              {counter.checkKind[entry.kind]} «{entry.name}» —{' '}
              {fill(counter.checkReasons[entry.reason], { name: nameFor(entry.reason) })
                .replace(/ — номер не будет выдан$/, '')
                .toLowerCase()}
            </li>
          ))}
          {data.hiddenOutside > 0 ? (
            <li>{fill(counter.coverageHidden, { count: String(data.hiddenOutside) })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
