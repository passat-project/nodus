import type { CreationFieldSlot, CustomFieldDefinition, WorkflowProblem } from '@nodus/contracts';
import { presetAllowed, requiredAllowed, ui } from '@nodus/contracts';
import { CircleAlert } from 'lucide-react';

import { SlotControl } from '../../../../../shared/tasks/task-create-fields.js';
import { initialPreset, type SlotPatch } from '../../../model/creation-form.js';
import { CommitInput } from '../../../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';

const c = ui.automation.creation;

/**
 * Раздел одного поля окна создания (#432, Р12; переход внутрь из строки
 * списка, шапка «Поле окна» со стрелкой «назад»): своё название в форме,
 * «Обязательно при создании», «Скрыть и заполнить значением» с редактором
 * значения (тот же контрол, что увидит сотрудник), «Убрать из формы» внизу.
 * Правила — общая грамматика contracts: у ответственного и приоритета нет
 * обязательности, у срока — скрытого значения, скрытый атрибут реестра
 * бывает только скрытым полем; скрытое и обязательное взаимоисключающи.
 */
export function CreationSlotSection({
  slot,
  standardLabel,
  definition,
  presetLabel,
  problems,
  readOnly,
  onChange,
  onRemove,
}: {
  slot: CreationFieldSlot;
  /** Название без своего (роль типа или стандартное) — подсказка в поле. */
  standardLabel: string;
  /** Определение атрибута (для `cf.<id>`), включая скрытые реестра. */
  definition?: CustomFieldDefinition;
  /** Скрытое значение текстом — для просмотра без права правки. */
  presetLabel: string | null;
  problems: readonly WorkflowProblem[];
  readOnly: boolean;
  onChange: (patch: SlotPatch, coalesce?: string) => void;
  onRemove: () => void;
}) {
  const hidden = slot.preset !== null;
  const hiddenAttribute = definition?.hidden === true;
  const canHide = presetAllowed(slot.key);
  const requiredHint = !requiredAllowed(slot.key)
    ? c.requiredAlways
    : hidden
      ? ui.automation.problems.creation_hidden_required
      : c.requiredHint;
  const hideHint = !canHide ? c.hideNotAllowed : hiddenAttribute ? c.hideAttributeOnly : c.hideHint;

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
          disabled={readOnly || !canHide || (hiddenAttribute && hidden)}
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

      {readOnly ? null : <PanelDanger onClick={onRemove}>{c.removeFromForm}</PanelDanger>}
    </>
  );
}
