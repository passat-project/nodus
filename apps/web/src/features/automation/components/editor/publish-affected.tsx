import type { ProcessCategory } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { pluralRu } from '../../lib/plural-ru.js';

/**
 * Блок предпросмотра публикации (#430): какие типы используют маршрут и
 * сколько сущностей в полёте. Вынесен из диалога (I5), чтобы диалог не
 * разрастался; данные — из WorkflowDetail и списка типов. Ступень тона, а не
 * рамка (канон: линия — только функциональная граница), метки и значения в
 * одной сетке — габарит не прыгает от длины названий.
 */
export function PublishAffected({
  typeNames,
  inFlight,
  category,
}: {
  typeNames: readonly string[];
  inFlight: number;
  category: ProcessCategory;
}) {
  const unit = pluralRu(
    inFlight,
    category === 'letter'
      ? ui.automation.publishAffectedLetters
      : ui.automation.publishAffectedTasks,
  );
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-accent/40 px-3 py-2.5">
      <p className="text-label-sm font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {ui.automation.publishAffectedTitle}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{ui.automation.publishAffectedTypes}</dt>
        <dd className="min-w-0 break-words">
          {typeNames.length > 0 ? (
            typeNames.join(', ')
          ) : (
            <span className="text-muted-foreground">{ui.automation.publishAffectedNoTypes}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">{ui.automation.publishAffectedInFlight}</dt>
        <dd>
          {inFlight > 0 ? (
            `${inFlight} ${unit}`
          ) : (
            <span className="text-muted-foreground">
              {category === 'letter'
                ? ui.automation.publishAffectedNoLetters
                : ui.automation.publishAffectedNoTasks}
            </span>
          )}
        </dd>
      </dl>
    </section>
  );
}
