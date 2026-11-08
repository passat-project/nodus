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
  counterPreviewOf,
  fill,
  ruleShort,
  unreachableReason,
  type ContainerNames,
} from '../../lib/counter-rule.js';
import type { FieldDraft } from '../../lib/field-draft.js';
import {
  CounterRuleDialog,
  type CounterRuleKit,
  type SegmentFieldGroup,
} from './counter-rule-dialog.js';
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

/** Атрибуты, которые можно вставить в номер: не счётчики и не формульные
 *  «глобальные» — только значения записей. */
const insertable = (entry: CustomFieldDefinition, self: string | undefined) =>
  entry.id !== self && entry.type !== 'counter';

/**
 * Счётчик в окне атрибута (#630, модель v3): одна строка-сводка правила
 * («Номер «Изм. 1» получают «Изменение» — свой счёт для каждой папки
 * «Комплект».») с кнопкой, открывающей ОТДЕЛЬНОЕ окно «Правило номера». В
 * окне — «Кто получает номер» и когда (у каждого типа свой способ), потом
 * «Вести счёт отдельно для» и вид номера. Правило одно на атрибут.
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
  const taskDefinitions = useCustomFieldDefinitions('task').data ?? [];
  const letterDefinitions = useCustomFieldDefinitions('letter').data ?? [];
  const projectDefinitions = useCustomFieldDefinitions('project').data ?? [];
  const nodeDefinitions = useCustomFieldDefinitions('node').data ?? [];
  const companyDefinitions = useCustomFieldDefinitions('company').data ?? [];
  const allDefinitions = [
    ...new Map(
      [
        ...taskDefinitions,
        ...letterDefinitions,
        ...projectDefinitions,
        ...nodeDefinitions,
        ...companyDefinitions,
      ].map((entry) => [entry.id, entry]),
    ).values(),
  ];
  const issuers = definition?.numbering?.issuers ?? [];

  const names: ContainerNames = {
    nodeKind: (id) => nodeKinds?.find((kind) => kind.id === id)?.name,
    field: (number) => allDefinitions.find((entry) => entry.number === number)?.name,
  };
  const targetName = (id: string) =>
    processTypes?.find((type) => type.id === id)?.name ??
    projectTypes?.find((type) => type.id === id)?.name ??
    nodeKinds?.find((kind) => kind.id === id)?.name;
  const hostKindOf = (id: string): NumberHostKind | null => {
    const process = processTypes?.find((type) => type.id === id);
    if (process) return process.category === 'letter' ? 'letter' : 'task';
    if (projectTypes?.some((type) => type.id === id)) return 'project';
    if (nodeKinds?.some((kind) => kind.id === id)) return 'node';
    return null;
  };
  const alive = (nodeKinds ?? []).filter((kind) => kind.archivedAt === null);

  const kit: CounterRuleKit = {
    names,
    issuers,
    typeName: targetName,
    hostKindOf,
    definitions: allDefinitions,
    nodeKinds: alive,
    // Виды папок для «Каждой папки вида…»: если номер получают папки —
    // только виды, которые бывают в тех же типах проектов, что и они
    // (`kindIds` типа проекта, #556; null — все виды).
    nodeKindsFor: (bindings: CustomFieldBindings) => {
      if (bindings.nodeKindIds.length === 0) return alive;
      const types = (projectTypes ?? []).filter(
        (type) =>
          type.kindIds === null || bindings.nodeKindIds.some((id) => type.kindIds!.includes(id)),
      );
      if (types.length === 0 || types.some((type) => type.kindIds === null)) return alive;
      const allowed = new Set(types.flatMap((type) => type.kindIds ?? []));
      return alive.filter((kind) => allowed.has(kind.id));
    },
    summaryOf: (rule: NumberSeriesRule, next: number | null, bindings: CustomFieldBindings) => {
      const who = idsOf(bindings)
        .map(targetName)
        .filter((name): name is string => Boolean(name))
        .map((name) => `«${name}»`)
        .join(', ');
      return fill(counter.summary, {
        example: counterPreviewOf(rule, rule.containers.length === 0 ? next : null),
        who: who || counter.summaryNobody,
        where: ruleShort(rule, names),
      });
    },
    describeTargetFor:
      (rule: NumberSeriesRule): DescribeTarget =>
      (group) => {
        const reason = unreachableReason(rule.containers, HOST_OF_GROUP[group]);
        return reason ? { text: reason, tone: 'danger', blocked: true } : null;
      },
    hostKindsOf: (bindings: CustomFieldBindings) => {
      const kinds = new Set<NumberHostKind>();
      for (const id of idsOf(bindings)) {
        const host = hostKindOf(id);
        if (host) kinds.add(host);
      }
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
    // Палитра «Поле…» вида номера — по источникам: поля самой записи (у
    // КАЖДОГО отмеченного типа), проекта, папки вида, компании.
    segmentFieldsFor: (bindings: CustomFieldBindings): SegmentFieldGroup[] => {
      const chosen = idsOf(bindings);
      const self = allDefinitions.filter(
        (entry) =>
          insertable(entry, definition?.id) &&
          !entry.isCompany &&
          chosen.length > 0 &&
          chosen.every((id) => idsOf(entry.bindings).includes(id)),
      );
      const project = projectDefinitions.filter((entry) => insertable(entry, definition?.id));
      const company = companyDefinitions.filter((entry) => insertable(entry, definition?.id));
      const groups: SegmentFieldGroup[] = [
        { source: 'self', fields: self },
        { source: 'project', fields: project },
        ...alive.map((kind) => ({
          source: 'folder' as const,
          nodeKindId: kind.id,
          kindName: kind.name,
          fields: nodeDefinitions.filter(
            (entry) =>
              insertable(entry, definition?.id) && entry.bindings.nodeKindIds.includes(kind.id),
          ),
        })),
        { source: 'company', fields: company },
      ];
      return groups.filter((group) => group.fields.length > 0);
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
          onCreate={draft.numberingOnCreate}
          definition={definition}
          preview={preview}
          kit={kit}
          disabled={disabled}
          onSave={(numbering, numberingNext, bindings, numberingOnCreate) =>
            onChange({ numbering, numberingNext, bindings, numberingOnCreate })
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
