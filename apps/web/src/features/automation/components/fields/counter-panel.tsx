import { useState } from 'react';
import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  FormulaHostKind,
  NumberHostKind,
  NumberSeriesRule,
} from '@nodus/contracts';
import { NUMBER_CONTAINER_FIELD_TYPES, ui } from '@nodus/contracts';
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
import { CounterRuleDialog, type CounterRuleKit } from './counter-rule-dialog.js';
import type { DescribeTarget } from './field-usage-picker.js';

const counter = ui.customFields.dialog.counter;

const HOST_OF_GROUP: Record<FormulaHostKind, NumberHostKind> = {
  task: 'task',
  letter: 'letter',
  node: 'node',
  project: 'project',
};

const idsOf = (bindings: CustomFieldBindings) => [
  ...bindings.processTypeIds,
  ...bindings.projectTypeIds,
  ...bindings.nodeKindIds,
];

/**
 * Счётчик в окне атрибута (#630): одна строка-сводка правила («Номер «Изм. 1»
 * получают «Изменение» — свой счёт в каждой папке «Комплект».») с кнопкой,
 * открывающей ОТДЕЛЬНОЕ окно «Правило номера». В окне — «Кто получает
 * номер» первым шагом, потом «Вести счёт отдельно для» и вид номера.
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
  const issuers = definition?.numbering?.issuers ?? [];

  const names: ContainerNames = {
    nodeKind: (id) => nodeKinds?.find((kind) => kind.id === id)?.name,
    field: (number) => allDefinitions.find((entry) => entry.number === number)?.name,
  };
  const targetName = (id: string) =>
    processTypes?.find((type) => type.id === id)?.name ??
    projectTypes?.find((type) => type.id === id)?.name ??
    nodeKinds?.find((kind) => kind.id === id)?.name;

  const kit: CounterRuleKit = {
    names,
    issuers,
    typeName: targetName,
    definitions: allDefinitions,
    nodeKinds: (nodeKinds ?? []).filter((kind) => kind.archivedAt === null),
    summaryOf: (rule: NumberSeriesRule, next: number | null, bindings: CustomFieldBindings) => {
      const who = idsOf(bindings)
        .map(targetName)
        .filter((name): name is string => Boolean(name))
        .map((name) => `«${name}»`)
        .join(', ');
      return fill(counter.summary, {
        example: counterPreviewOf(rule, rule.container.kind === 'company' ? next : null),
        who: who || counter.summaryNobody,
        where: containerShort(rule.container, names),
      });
    },
    describeTargetFor:
      (rule: NumberSeriesRule): DescribeTarget =>
      (group, targetId) => {
        const reason = unreachableReason(rule.container, HOST_OF_GROUP[group]);
        if (reason) return { text: reason, tone: 'danger', blocked: true };
        if (group !== 'task' && group !== 'letter') return null;
        const buttons = issuers.filter((issuer) => issuer.processTypeId === targetId);
        return buttons.length > 0
          ? {
              text: fill(counter.issuedBy, {
                buttons: buttons.map((issuer) => `«${issuer.transitionName}»`).join(', '),
              }),
              tone: 'muted',
              blocked: false,
            }
          : { text: counter.notIssued, tone: 'warn', blocked: false };
      },
    hostKindsOf: (bindings: CustomFieldBindings) => {
      const kinds = new Set<NumberHostKind>();
      for (const id of bindings.processTypeIds) {
        const category = processTypes?.find((type) => type.id === id)?.category;
        kinds.add(category === 'letter' ? 'letter' : 'task');
      }
      if (bindings.nodeKindIds.length > 0) kinds.add('node');
      if (bindings.projectTypeIds.length > 0) kinds.add('project');
      return [...kinds];
    },
    // Поля «каждого значения поля»: ссылка или список, стоящие у КАЖДОГО
    // отмеченного типа — у записи без поля счёта бы не нашлось.
    fieldsFor: (bindings: CustomFieldBindings) => {
      const chosen = idsOf(bindings);
      if (chosen.length === 0) return [];
      return allDefinitions
        .filter(
          (entry) =>
            entry.id !== definition?.id &&
            !entry.isCompany &&
            (NUMBER_CONTAINER_FIELD_TYPES as readonly string[]).includes(entry.type) &&
            chosen.every((id) => idsOf(entry.bindings).includes(id)),
        )
        .map((entry) => ({ number: entry.number, name: entry.name }));
    },
  };

  return (
    <section className="flex flex-col gap-2">
      <NodeLabel label={counter.title} />
      <button
        type="button"
        disabled={disabled}
        aria-label={counter.edit}
        onClick={() => setOpen(true)}
        className="group flex min-w-0 items-center gap-3 rounded-lg border border-input bg-background py-2 pr-2 pl-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 text-sm">
          {kit.summaryOf(draft.numbering, draft.numberingNext, draft.bindings)}
        </span>
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
        >
          <Calculator className="size-4" strokeWidth={1.75} />
        </span>
      </button>
      {open ? (
        <CounterRuleDialog
          name={draft.name}
          rule={draft.numbering}
          next={draft.numberingNext}
          bindings={draft.bindings}
          definition={definition}
          preview={preview}
          kit={kit}
          disabled={disabled}
          onSave={(numbering, numberingNext, bindings) =>
            onChange({ numbering, numberingNext, bindings })
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
