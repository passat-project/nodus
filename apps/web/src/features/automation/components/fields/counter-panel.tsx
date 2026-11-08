import { useState } from 'react';
import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  FormulaHostKind,
  NumberHostKind,
  NumberSeriesRule,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Calculator } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useProcessTypes } from '../../api/automation-api.js';
import {
  containerShort,
  counterPreviewOf,
  fill,
  unreachableReason,
  type ContainerNames,
} from '../../lib/counter-rule.js';
import type { FieldDraft } from '../../lib/field-draft.js';
import { CounterRuleDialog } from './counter-rule-dialog.js';
import { FieldUsagePicker, type DescribeTarget } from './field-usage-picker.js';

const counter = ui.customFields.dialog.counter;

const HOST_OF_GROUP: Record<FormulaHostKind, NumberHostKind> = {
  task: 'task',
  letter: 'letter',
  node: 'node',
  project: 'project',
};

/**
 * Счётчик в окне атрибута (#630): в основном окне — одна строка-сводка
 * правила («Номер «Изм. 1» получают «Изменение» — свой счёт в каждой
 * папке «Комплект».») с кнопкой, открывающей ОТДЕЛЬНОЕ окно правила, и
 * «Кто получает номер» (привязки с кнопками-выдатчиками и совместимостью).
 * Правило одно на атрибут — у привязок нет своих формул и правил.
 */
export function CounterPanel({
  draft,
  definition,
  preview,
  disabled,
  onChange,
}: {
  draft: FieldDraft;
  definition: CustomFieldDefinition | null;
  preview: CustomFieldDefinition | null;
  disabled: boolean;
  onChange: (next: Partial<FieldDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: processTypes } = useProcessTypes('include');
  const { data: projectTypes } = useProjectTypes(true);
  const { data: nodeKinds } = useNodeKinds();
  const allDefinitions = useCustomFieldDefinitions('task').data ?? [];
  const rule = draft.numbering;
  const issuers = definition?.numbering?.issuers ?? [];

  const names: ContainerNames = {
    nodeKind: (id) => nodeKinds?.find((kind) => kind.id === id)?.name,
    field: (number) => allDefinitions.find((entry) => entry.number === number)?.name,
  };
  const targetName = (id: string) =>
    processTypes?.find((type) => type.id === id)?.name ??
    projectTypes?.find((type) => type.id === id)?.name ??
    nodeKinds?.find((kind) => kind.id === id)?.name;

  const chosen = [
    ...draft.bindings.processTypeIds,
    ...draft.bindings.projectTypeIds,
    ...draft.bindings.nodeKindIds,
  ];
  const who = chosen
    .map(targetName)
    .filter((name): name is string => Boolean(name))
    .map((name) => `«${name}»`)
    .join(', ');
  const summaryOf = (next: NumberSeriesRule, nextNumber: number | null) =>
    fill(counter.summary, {
      example: counterPreviewOf(next, next.container.kind === 'company' ? nextNumber : null),
      who: who || counter.summaryNobody,
      where: containerShort(next.container, names),
    });

  const describeTarget: DescribeTarget = (group, targetId) => {
    const reason = unreachableReason(rule.container, HOST_OF_GROUP[group]);
    if (reason) return { text: reason, tone: 'danger', blocked: true };
    if (group === 'task' || group === 'letter') {
      const buttons = issuers.filter((issuer) => issuer.processTypeId === targetId);
      if (buttons.length > 0) {
        return {
          text: fill(counter.issuedBy, {
            buttons: buttons.map((issuer) => `«${issuer.transitionName}»`).join(', '),
          }),
          tone: 'muted',
          blocked: false,
        };
      }
      return { text: counter.notIssued, tone: 'warn', blocked: false };
    }
    return null;
  };

  const kinds = new Set<NumberHostKind>();
  for (const id of draft.bindings.processTypeIds) {
    kinds.add(
      processTypes?.find((type) => type.id === id)?.category === 'letter' ? 'letter' : 'task',
    );
  }
  if (draft.bindings.nodeKindIds.length > 0) kinds.add('node');
  if (draft.bindings.projectTypeIds.length > 0) kinds.add('project');

  return (
    <>
      <section className="flex flex-col gap-2">
        <NodeLabel label={counter.title} />
        <button
          type="button"
          disabled={disabled}
          aria-label={counter.edit}
          onClick={() => setOpen(true)}
          className="group flex min-w-0 items-center gap-3 rounded-lg border border-input bg-background py-2 pr-2 pl-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 text-sm">{summaryOf(rule, draft.numberingNext)}</span>
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
          >
            <Calculator className="size-4" strokeWidth={1.75} />
          </span>
        </button>
      </section>
      <section className="flex flex-col gap-3">
        <NodeLabel label={counter.recipients} />
        <FieldUsagePicker
          definition={preview}
          bindings={draft.bindings}
          bindingFormulas={{}}
          onBindingFormulasChange={() => undefined}
          disabled={disabled}
          allowFormulas={false}
          describeTarget={describeTarget}
          hint={counter.recipientsHint}
          onChange={(bindings: CustomFieldBindings) => onChange({ bindings })}
        />
      </section>
      {open ? (
        <CounterRuleDialog
          name={draft.name}
          rule={rule}
          next={draft.numberingNext}
          summaryOf={summaryOf}
          definition={definition}
          participantTypeIds={chosen}
          kinds={[...kinds]}
          definitions={allDefinitions}
          nodeKinds={(nodeKinds ?? []).filter((kind) => kind.archivedAt === null)}
          names={names}
          disabled={disabled}
          onSave={(numbering, numberingNext) => onChange({ numbering, numberingNext })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
