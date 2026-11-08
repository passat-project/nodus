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
  const kindName =
    rule.container.kind === 'folder'
      ? (names.nodeKind(rule.container.nodeKindId) ?? '')
      : rule.container.kind === 'field'
        ? (names.field(rule.container.fieldNumber) ?? '')
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
              {fill(counter.checkReasons[entry.reason], { name: kindName })
                .replace(/ — номер не будет выдан$/, '')
                .toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
