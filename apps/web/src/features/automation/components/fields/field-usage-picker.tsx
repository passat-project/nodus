import { useState } from 'react';
import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { BindingFormulaDialog } from './binding-formula-dialog.js';
import { Group, type DescribeTarget, type Target } from './field-usage-group.js';

export type { DescribeTarget, TargetNote } from './field-usage-group.js';

/**
 * «Где используется» окна атрибута (#631, Р11): галочки модулей с
 * раскрытием до конкретных типов и видов. Та же привязка видна и ставится
 * из формы типа или вида — механизм один (Р3). Глобальная переменная
 * привязок не имеет — пикер скрыт (Р7).
 */

export function FieldUsagePicker({
  definition,
  bindings,
  bindingFormulas,
  onBindingFormulasChange,
  disabled,
  allowFormulas = true,
  describeTarget,
  hint,
  onlyGroups,
  onChange,
}: {
  /** Показать только эти модули (счётчик: номер выдаёт кнопка маршрута —
   *  маршруты есть только у задач и писем). */
  onlyGroups?: readonly FormulaHostKind[];
  definition: CustomFieldDefinition | null;
  bindings: CustomFieldBindings;
  bindingFormulas: Record<string, FormulaNode>;
  onBindingFormulasChange: (formulas: Record<string, FormulaNode>) => void;
  disabled: boolean;
  /** Counter получает значение по кнопке процесса, а не из формулы места (#630). */
  allowFormulas?: boolean;
  /** Подпись под целью (счётчик: кто выдаёт, совместимость). */
  describeTarget?: DescribeTarget;
  /** Подсказка под пикером вместо общей. */
  hint?: string;
  onChange: (bindings: CustomFieldBindings) => void;
}) {
  const [formulaTarget, setFormulaTarget] = useState<{
    target: Target;
    hostKind: FormulaHostKind;
  } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Архивные цели включаются, только если уже стоят в привязках (#646):
  // иначе их нельзя ни увидеть, ни снять, а сохранение полного набора
  // упирается в запрет привязки к архиву. Новую привязку к архиву не
  // предлагаем — сервер её по-прежнему отклоняет.
  const { data: processTypes } = useProcessTypes('include');
  const { data: projectTypes } = useProjectTypes(true);
  const { data: nodeKinds } = useNodeKinds();

  const label = (name: string, archived: boolean) =>
    archived ? `${name} (${ui.customFields.bind.archived})` : name;
  const taskTypes: Target[] = (processTypes ?? [])
    .filter(
      (type) =>
        type.category === 'task' && (!type.archivedAt || bindings.processTypeIds.includes(type.id)),
    )
    .map((type) => ({ id: type.id, name: label(type.name, type.archivedAt !== null) }));
  const letterTypes: Target[] = (processTypes ?? [])
    .filter(
      (type) =>
        type.category === 'letter' &&
        (!type.archivedAt || bindings.processTypeIds.includes(type.id)),
    )
    .map((type) => ({ id: type.id, name: label(type.name, type.archivedAt !== null) }));
  const types: Target[] = (projectTypes ?? [])
    .filter((type) => type.archivedAt === null || bindings.projectTypeIds.includes(type.id))
    .map((type) => ({ id: type.id, name: label(type.name, type.archivedAt !== null) }));
  const kinds: Target[] = (nodeKinds ?? []).map((kind) => ({
    id: kind.id,
    name: label(kind.name, kind.archivedAt !== null),
  }));

  const toggleList = (current: string[], all: readonly Target[]): string[] => {
    const set = new Set(current);
    const chosen = all.filter((target) => set.has(target.id)).length;
    const selectAll = chosen !== all.length;
    for (const target of all) {
      if (selectAll) set.add(target.id);
      else set.delete(target.id);
    }
    return [...set];
  };

  const toggleOne = (current: string[], id: string): string[] =>
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id];

  const groups: Array<{
    key: FormulaHostKind;
    label: string;
    targets: readonly Target[];
    selected: string[];
    list: 'processTypeIds' | 'projectTypeIds' | 'nodeKindIds';
  }> = [
    {
      key: 'task',
      label: ui.customFields.bind.groupTaskTypes,
      targets: taskTypes,
      selected: bindings.processTypeIds.filter((id) => taskTypes.some((t) => t.id === id)),
      list: 'processTypeIds',
    },
    {
      key: 'letter',
      label: ui.customFields.bind.groupLetterTypes,
      targets: letterTypes,
      selected: bindings.processTypeIds.filter((id) => letterTypes.some((t) => t.id === id)),
      list: 'processTypeIds',
    },
    {
      key: 'project',
      label: ui.customFields.bind.groupProjectTypes,
      targets: types,
      selected: bindings.projectTypeIds,
      list: 'projectTypeIds',
    },
    {
      key: 'node',
      label: ui.customFields.bind.groupNodeKinds,
      targets: kinds,
      selected: bindings.nodeKindIds,
      list: 'nodeKindIds',
    },
  ];
  const shown = onlyGroups ? groups.filter((group) => onlyGroups.includes(group.key)) : groups;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1.5">
        {shown.map((group) => (
          <Group
            key={group.key}
            label={group.label}
            targets={group.targets}
            selected={new Set(group.selected)}
            expanded={expanded[group.key] ?? false}
            onToggleExpand={() =>
              setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))
            }
            onToggleAll={() =>
              onChange({
                ...bindings,
                [group.list]: toggleList(bindings[group.list], group.targets),
              })
            }
            onToggleOne={(id) =>
              onChange({ ...bindings, [group.list]: toggleOne(bindings[group.list], id) })
            }
            disabled={disabled}
            allowFormulas={allowFormulas}
            onEditFormula={(target) =>
              setFormulaTarget({ target, hostKind: group.key as FormulaHostKind })
            }
            describe={
              describeTarget
                ? (targetId, on) => describeTarget(group.key as FormulaHostKind, targetId, on)
                : undefined
            }
          />
        ))}
      </div>
      <p className="text-xs break-words text-muted-foreground">
        {hint ?? ui.customFields.bind.usageHint}
      </p>
      {allowFormulas && formulaTarget && definition ? (
        <BindingFormulaDialog
          targetId={formulaTarget.target.id}
          hostKind={formulaTarget.hostKind}
          definition={definition}
          initial={bindingFormulas[formulaTarget.target.id] ?? null}
          onSave={(ast) => {
            const next = { ...bindingFormulas };
            if (ast) next[formulaTarget.target.id] = ast;
            else delete next[formulaTarget.target.id];
            onBindingFormulasChange(next);
          }}
          onClose={() => setFormulaTarget(null)}
        />
      ) : null}
    </div>
  );
}
