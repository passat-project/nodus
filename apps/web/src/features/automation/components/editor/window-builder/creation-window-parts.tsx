import type {
  CreationChip,
  CreationFieldKey,
  CustomFieldDefinition,
  CustomFieldType,
  FormulaNode,
} from '@nodus/contracts';
import { presetAllowed, requiredAllowed, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { Settings2 } from 'lucide-react';

import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import type { PreviewKind } from '../../../../../shared/forms/builder/builder-host.js';
import type { BuilderBlock } from '../../../../../shared/forms/builder/builder-model.js';
import { PreviewControl } from '../../../../../shared/forms/builder/preview-control.js';
import { SlotControl } from '../../../../../shared/tasks/task-create-fields.js';
import { PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import type { CreationExtra } from '../../../model/creation-builder.js';
import { initialPreset } from '../../../model/creation-form.js';

const b = ui.forms.builder;
const c = ui.automation.creation;

/** Виды полей стандартных слотов — тем же контролом, что у поля задачи. */
export const SYSTEM_PREVIEW: Readonly<Record<string, PreviewKind>> = {
  description: 'text',
  assignee: 'people',
  coexecutors: 'people',
  observers: 'people',
  deadline: 'date',
  priority: 'select',
  project: 'select',
};

export const CHIP_LABEL: Readonly<Record<CreationChip, string>> = {
  checklist: c.chipChecklist,
  planned: c.chipPlanned,
};

export const CHIP_HINT: Readonly<Record<CreationChip, string>> = {
  checklist: c.chipChecklistHint,
  planned: c.chipPlannedHint,
};

/** Тип стандартного поля окна создания — результат формулы слота (Р12). */
const SLOT_TYPES: Readonly<Record<string, CustomFieldType>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  coexecutors: 'users',
  observers: 'users',
  priority: 'enum',
  project: 'project',
};

/** Своё поля окна создания — в тех же настройках, что у блока и формулы:
 *  обязательность, скрытое значение с редактором, формула. */
export function CreationFieldSettings({
  field,
  definition,
  standardLabel,
  ownDefinitions,
  hostKind,
  readOnly,
  requiredHint,
  onFormula,
  onRequired,
  onPreset,
}: {
  field: { key: string; extra: CreationExtra };
  definition: CustomFieldDefinition | undefined;
  standardLabel: string;
  ownDefinitions: readonly CustomFieldDefinition[];
  hostKind: 'task' | 'letter';
  readOnly: boolean;
  requiredHint: string;
  onFormula: (formula: FormulaNode | null) => void;
  onRequired: (required: boolean) => void;
  onPreset: (preset: CreationExtra['preset']) => void;
}) {
  const key = field.key as CreationFieldKey;
  const hidden = field.extra.preset !== null;
  const canHide = presetAllowed(key);
  const canRequire = requiredAllowed(key);
  return (
    <>
      <SwitchRow
        title={c.required}
        hint={requiredHint}
        checked={field.extra.required}
        disabled={readOnly || hidden || !canRequire}
        onChange={onRequired}
      />
      <SwitchRow
        title={c.hideTitle}
        hint={canHide ? c.hideHint : c.hideNotAllowed}
        checked={hidden}
        disabled={readOnly || !canHide}
        onChange={(hide) => onPreset(hide ? initialPreset(key) : null)}
      />
      {hidden ? (
        <PanelField label={c.preset}>
          <SlotControl
            slot={{
              key,
              label: null,
              required: field.extra.required,
              preset: field.extra.preset,
            }}
            definition={definition}
            value={field.extra.preset === '' ? undefined : field.extra.preset}
            invalid={false}
            label={c.preset}
            onChange={(value) => onPreset((value ?? initialPreset(key)) as CreationExtra['preset'])}
          />
        </PanelField>
      ) : null}
      <PanelField label={ui.formulas.typeFormula.field} hint={ui.formulas.typeFormula.hint}>
        <TypeFormulaControl
          hostKind={hostKind}
          {...(definition
            ? { definition }
            : { targetType: SLOT_TYPES[key] ?? 'text', label: standardLabel })}
          ownDefinitions={ownDefinitions}
          value={field.extra.formula ?? null}
          readOnly={readOnly}
          onChange={onFormula}
        />
      </PanelField>
    </>
  );
}

/** Превью чипа: тот же вид, что у сотрудника внизу окна. */
export function ChipPreview({ block }: { block: BuilderBlock<CreationExtra> }) {
  const chip = block.block.replace('chip:', '') as CreationChip;
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-dashed border-border px-2.5 text-sm text-muted-foreground">
      <span className="size-3.5 rounded-sm border border-border" aria-hidden />
      {CHIP_LABEL[chip]}
    </div>
  );
}

/** Неподвижный верх окна: название (с формулой) и тип — всегда первыми. */
export function CreationFixedRows({
  typeName,
  titleFormula,
  ownDefinitions,
  hostKind,
  readOnly,
  onChange,
}: {
  typeName: string;
  titleFormula: FormulaNode | null;
  ownDefinitions: readonly CustomFieldDefinition[];
  hostKind: 'task' | 'letter';
  readOnly: boolean;
  onChange: (formula: FormulaNode | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 px-2" title={b.fixedRow}>
      <div className="flex min-w-0 items-center gap-1">
        <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-input px-2.5 text-body-lg text-muted-foreground dark:bg-input/30">
          {ui.taskCreate.titlePlaceholder}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground"
              aria-label={b.titleFormula}
              title={b.titleFormula}
            >
              <Settings2 className="size-3.5" strokeWidth={1.75} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <PanelField label={b.titleFormula} hint={b.titleFormulaHint}>
              <TypeFormulaControl
                hostKind={hostKind}
                targetType="text"
                label={b.systemLabels.title}
                ownDefinitions={ownDefinitions}
                value={titleFormula}
                readOnly={readOnly}
                allowRelated
                onChange={onChange}
              />
            </PanelField>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <NodeLabel label={ui.taskCreate.typeLabel} />
        <span className="relative">
          <PreviewControl kind="select" />
          <span className="absolute inset-y-0 left-2.5 flex items-center truncate text-sm">
            {typeName}
          </span>
        </span>
      </div>
    </div>
  );
}
