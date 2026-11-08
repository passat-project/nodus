import type {
  CreationFieldSlot,
  CustomFieldDefinition,
  CustomFieldType,
  FormulaHostKind,
  WorkflowProblem,
} from '@nodus/contracts';
import { presetAllowed, requiredAllowed, ui } from '@nodus/contracts';
import { CircleAlert } from 'lucide-react';

import { SlotControl } from '../../../../../shared/tasks/task-create-fields.js';
import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import { initialPreset, type SlotPatch } from '../../../model/creation-form.js';
import { CommitInput } from '../../../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';

const c = ui.automation.creation;

/** Тип стандартного поля формы создания — результат формулы (Р12). */
const SLOT_TYPES: Readonly<Record<string, CustomFieldType>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  coexecutors: 'users',
  observers: 'users',
  priority: 'enum',
  project: 'project',
};

/**
 * Раздел одного поля окна создания (#432, Р12; переход внутрь из строки
 * списка, шапка «Поле окна» со стрелкой «назад»): своё название в форме,
 * «Обязательно при создании», «Скрыть и заполнить значением» с редактором
 * значения (тот же контрол, что увидит сотрудник), «Убрать из формы» внизу.
 * Правила — общая грамматика contracts: у ответственного и приоритета нет
 * обязательности, у срока — скрытого значения; скрытое и обязательное
 * взаимоисключающи.
 */
export function CreationSlotSection({
  slot,
  standardLabel,
  definition,
  ownDefinitions,
  hostKind,
  presetLabel,
  problems,
  readOnly,
  onChange,
  onRemove,
  compact = false,
}: {
  slot: CreationFieldSlot;
  /** Название без своего (роль типа или стандартное) — подсказка в поле. */
  standardLabel: string;
  /** Определение атрибута (для `cf.<id>`). */
  definition?: CustomFieldDefinition;
  /** Атрибуты места — палитра конструктора формулы слота. */
  ownDefinitions: readonly CustomFieldDefinition[];
  /** Носитель формулы слота: задача или письмо (Р12). */
  hostKind: FormulaHostKind;
  /** Скрытое значение текстом — для просмотра без права правки. */
  presetLabel: string | null;
  problems: readonly WorkflowProblem[];
  readOnly: boolean;
  onChange: (patch: SlotPatch, coalesce?: string) => void;
  onRemove: () => void;
  /** В настройках поля редактора окна (#496): подпись и «Убрать» показывает
   *  сам редактор — здесь только своё окна создания. */
  compact?: boolean;
}) {
  const hidden = slot.preset !== null;
  const canHide = presetAllowed(slot.key);
  const requiredHint = !requiredAllowed(slot.key)
    ? c.requiredAlways
    : hidden
      ? ui.automation.problems.creation_hidden_required
      : c.requiredHint;
  const hideHint = !canHide ? c.hideNotAllowed : c.hideHint;

  return (
    <>
      {problems.length > 0 ? (
        <div role="alert" className="flex min-w-0 flex-col gap-1">
          {problems.map((problem, index) => (
            <p
              key={`${problem.code}-${index}`}
              className="flex items-start gap-1.5 text-xs text-danger"
            >
              <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 break-words">{ui.automation.problems[problem.code]}</span>
            </p>
          ))}
        </div>
      ) : null}

      {compact ? null : (
        <PanelField label={c.labelTitle} hint={c.labelHint}>
          <CommitInput
            key={slot.key}
            value={slot.label ?? ''}
            maxLength={60}
            readOnly={readOnly}
            placeholder={standardLabel}
            aria-label={c.labelTitle}
            onCommit={(label) => onChange({ label })}
          />
        </PanelField>
      )}

      <SwitchRow
        title={c.required}
        hint={requiredHint}
        checked={slot.required}
        disabled={readOnly || hidden || !requiredAllowed(slot.key)}
        onChange={(required) => onChange({ required })}
      />

      <div className="flex min-w-0 flex-col gap-3">
        <SwitchRow
          title={c.hideTitle}
          hint={hideHint}
          checked={hidden}
          disabled={readOnly || !canHide}
          onChange={(hide) => onChange({ preset: hide ? initialPreset(slot.key) : null })}
        />
        {hidden ? (
          <PanelField label={c.preset}>
            {readOnly ? (
              <span className="text-sm break-words">{presetLabel ?? c.summaryPresetEmpty}</span>
            ) : (
              <SlotControl
                slot={slot}
                definition={definition}
                value={slot.preset === '' ? undefined : slot.preset}
                invalid={problems.some((problem) => problem.code === 'creation_preset_invalid')}
                label={c.preset}
                onChange={(value) =>
                  onChange(
                    { preset: (value ?? initialPreset(slot.key)) as CreationFieldSlot['preset'] },
                    `preset:${slot.key}`,
                  )
                }
              />
            )}
          </PanelField>
        ) : null}
      </div>

      <PanelField label={ui.formulas.typeFormula.field} hint={ui.formulas.typeFormula.hint}>
        <TypeFormulaControl
          hostKind={hostKind}
          {...(definition
            ? { definition }
            : { targetType: SLOT_TYPES[slot.key] ?? 'text', label: standardLabel })}
          ownDefinitions={ownDefinitions}
          value={slot.formula ?? null}
          readOnly={readOnly}
          onChange={(formula) => onChange({ formula })}
        />
      </PanelField>

      {readOnly || compact ? null : (
        <PanelDanger onClick={onRemove}>{c.removeFromForm}</PanelDanger>
      )}
    </>
  );
}
