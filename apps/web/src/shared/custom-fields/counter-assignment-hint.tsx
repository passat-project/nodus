import type { NumberHostKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useNumberHostAssignments } from './queries.js';

const assignment = ui.customFields.dialog.counter.assignment;

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const howOf = (source: string, label: string | null): string => {
  switch (source) {
    case 'create':
      return assignment.how.create;
    case 'type_change':
      return assignment.how.type_change;
    case 'transition':
      return fill(assignment.how.transition, { label: label ?? '' });
    case 'backfill':
      return assignment.how.backfill;
    case 'rule':
      return assignment.how.rule;
    case 'registry':
      return assignment.how.registry;
    case 'import':
      return assignment.how.import;
    default:
      return '';
  }
};

const dateOf = (iso: string): string =>
  new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso),
  );

/**
 * Подсказка у номера в карточке (#630, П5): когда, каким способом, кем и в
 * каком счёте выдан. Данные — журнал `number_assignments` сервера; в
 * мок-мире тот же маршрут отдаёт мок-стор.
 */
export function CounterAssignmentHint({
  fieldId,
  kind,
  hostId,
}: {
  fieldId: string;
  kind: NumberHostKind;
  hostId: string;
}) {
  const query = useNumberHostAssignments(kind, hostId);
  const item = query.data?.items.find((entry) => entry.fieldId === fieldId);
  if (!item) return null;
  const place =
    item.containers.length > 0
      ? item.containers.map((container) => container.name).join(' · ')
      : ui.customFields.dialog.counter.countsCompany;
  const who = item.actorName ? fill(assignment.who, { name: item.actorName }) : '';
  const text = `${fill(assignment.issued, {
    date: dateOf(item.assignedAt),
    how: howOf(item.source, item.sourceLabel),
    who,
  })} · ${fill(assignment.place, { place })}`;
  return <p className="text-[11px] leading-4 text-muted-foreground">{text}</p>;
}
