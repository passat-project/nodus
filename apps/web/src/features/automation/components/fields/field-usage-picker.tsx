import { useState } from 'react';
import { Calculator, Check, ChevronDown, Minus } from 'lucide-react';
import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { BindingFormulaDialog } from './binding-formula-dialog.js';

/**
 * «Где используется» окна атрибута (#631, Р11): галочки модулей с
 * раскрытием до конкретных типов и видов. Та же привязка видна и ставится
 * из формы типа или вида — механизм один (Р3). Глобальная переменная
 * привязок не имеет — пикер скрыт (Р7).
 */

interface Target {
  id: string;
  name: string;
}

/** Подпись под целью привязки (#630, счётчик): «Выдаёт кнопка …» или
 *  причина несовместимости. `blocked` — новую отметку поставить нельзя
 *  (уже отмеченная остаётся снимаемой — иначе её не убрать). */
export interface TargetNote {
  text: string;
  tone: 'muted' | 'warn' | 'danger';
  blocked: boolean;
}

export type DescribeTarget = (
  group: FormulaHostKind,
  targetId: string,
  on: boolean,
) => TargetNote | null;

/** Индикатор выбора — ведущий, у самого названия (как в FieldTypesPicker). */
function Mark({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border transition-colors',
        state === 'off' ? 'border-input' : 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {state === 'on' ? <Check className="size-3" strokeWidth={2.5} /> : null}
      {state === 'some' ? <Minus className="size-3" strokeWidth={2.5} /> : null}
    </span>
  );
}

function Group({
  label,
  targets,
  selected,
  expanded,
  onToggleExpand,
  onToggleAll,
  onToggleOne,
  disabled,
  allowFormulas,
  onEditFormula,
  describe,
}: {
  describe?: (targetId: string, on: boolean) => TargetNote | null;
  label: string;
  targets: readonly Target[];
  selected: ReadonlySet<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  disabled: boolean;
  allowFormulas: boolean;
  onEditFormula: (target: Target) => void;
}) {
  const chosen = targets.filter((target) => selected.has(target.id));
  const state = chosen.length === 0 ? 'off' : chosen.length === targets.length ? 'on' : 'some';
  const expandable = targets.length > 0;
  return (
    <div className="rounded-lg border border-input">
      {/* Строка группы: чекбокс «все» — сам по себе (клик по нему не
          раскрывает и не сбрасывает выбор), клик по остальной строке —
          раскрытие/сворачивание (вердикт владельца 06.11: случайный клик по
          строке не должен терять выбранные типы). Ховер раскрытия — до
          правого края, включая шеврон. */}
      <div className="flex items-stretch">
        <button
          type="button"
          role="checkbox"
          aria-checked={state === 'some' ? 'mixed' : state === 'on'}
          aria-label={label}
          disabled={disabled || !expandable}
          onClick={onToggleAll}
          className="flex w-9 shrink-0 items-center justify-center rounded-l-lg text-secondary-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Mark state={state} />
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={!expandable}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-r-lg py-2 pr-1.5 pl-0.5 text-left text-sm text-secondary-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {chosen.length}/{targets.length}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
            strokeWidth={1.75}
          />
        </button>
      </div>
      {expanded && expandable ? (
        <div className="flex flex-col gap-0.5 border-t py-1.5">
          {targets.map((target) => {
            const on = selected.has(target.id);
            const note = describe?.(target.id, on) ?? null;
            const blocked = !on && note?.blocked === true;
            return (
              <div
                key={target.id}
                className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-1"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={disabled || blocked}
                  title={blocked ? note?.text : undefined}
                  onClick={() => onToggleOne(target.id)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60',
                    on ? 'text-foreground' : 'text-secondary-foreground',
                    (disabled || blocked) && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Mark state={on ? 'on' : 'off'} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{target.name}</span>
                    {note && (on || blocked) ? (
                      <span
                        className={cn(
                          'truncate text-xs',
                          note.tone === 'danger'
                            ? 'text-danger'
                            : note.tone === 'warn'
                              ? 'text-warning'
                              : 'text-muted-foreground',
                        )}
                      >
                        {note.text}
                      </span>
                    ) : null}
                  </span>
                </button>
                {on && allowFormulas ? (
                  <button
                    type="button"
                    aria-label={ui.formulas.typeFormula.set}
                    title={ui.formulas.typeFormula.hint}
                    disabled={disabled}
                    onClick={() => onEditFormula(target)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Calculator className="size-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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
