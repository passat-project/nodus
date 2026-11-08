import { useMemo, useState } from 'react';
import type {
  CreationChip,
  CreationFieldKey,
  CreationForm,
  CustomFieldDefinition,
  FormulaNode,
  ProcessType,
} from '@nodus/contracts';
import {
  CREATION_FORM_LIMITS,
  LOCKABLE_SYSTEM_KEYS,
  TASK_CREATION_SYSTEM_KEYS,
  bindingsOf,
  creationChipSchema,
  customFieldIdOfKey,
  customFieldKey,
  requiredAllowed,
  slotLabel,
  typeConfigOf,
  ui,
} from '@nodus/contracts';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import type {
  BuilderBlockOption,
  BuilderFieldInfo,
  FormBuilderHost,
} from '../../../../../shared/forms/builder/builder-host.js';
import { FormBuilder } from '../../../../../shared/forms/builder/form-builder.js';
import { previewOfFieldType } from '../../../../../shared/forms/builder/preview-kind.js';
import {
  CHIP_HINT,
  CHIP_LABEL,
  ChipPreview,
  CreationFieldSettings,
  CreationFixedRows,
  SYSTEM_PREVIEW,
} from './creation-window-parts.js';
import {
  creationBlock,
  creationField,
  creationFromBuilder,
  creationToBuilder,
  type CreationExtra,
} from '../../../model/creation-builder.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';

const b = ui.forms.builder;
const c = ui.automation.creation;

/**
 * Редактор окна создания (#496, единое ядро) — вход из панели «Окно
 * создания». Поля, атрибуты и блоки окна — один список с одними настройками:
 * подпись, подсказка, обязательность, скрытое значение, формула, замок.
 * Название и тип — неподвижный верх окна; формула названия (#632) — в
 * настройках названия, а не отдельной строкой панели. «Готово» — одна правка
 * документа маршрута (история, черновик, публикация — как у кнопок).
 */
export function CreationWindowBuilder({
  open,
  type,
  form,
  readOnly,
  focusKey,
  onClose,
}: {
  open: boolean;
  type: ProcessType;
  form: CreationForm;
  readOnly: boolean;
  /** Поле, к которому пришли из проблемы публикации: настройки откроются. */
  focusKey?: string | null;
  onClose: () => void;
}) {
  const { data: definitions } = useCustomFieldDefinitions(type.category);
  const scoped = useMemo(() => definitions ?? [], [definitions]);
  const [titleFormula, setTitleFormula] = useState<FormulaNode | null>(form.titleFormula ?? null);
  const [openedFor, setOpenedFor] = useState(open);
  if (openedFor !== open) {
    setOpenedFor(open);
    if (open) setTitleFormula(form.titleFormula ?? null);
  }
  const value = useMemo(() => creationToBuilder(form), [form]);
  const host = useCreationHost(type, scoped, readOnly, titleFormula, setTitleFormula);
  return (
    <FormBuilder
      open={open}
      host={host}
      value={value}
      readOnly={readOnly}
      focusKey={focusKey ?? null}
      onCancel={onClose}
      onDone={(next) => {
        const base = creationFromBuilder(form, next);
        useRouteDocStore
          .getState()
          .setCreationForm(titleFormula ? { ...base, titleFormula } : base);
        onClose();
      }}
    />
  );
}

function useCreationHost(
  type: ProcessType,
  scoped: readonly CustomFieldDefinition[],
  readOnly: boolean,
  titleFormula: FormulaNode | null,
  setTitleFormula: (formula: FormulaNode | null) => void,
): FormBuilderHost<CreationExtra> {
  return useMemo(() => {
    const roleLabels = typeConfigOf(type).card.roleLabels;
    const inType = scoped.filter((entry) => bindingsOf(entry).processTypeIds.includes(type.id));
    const byId = new Map(scoped.map((entry) => [entry.id, entry]));
    const labelOf = (key: string) =>
      slotLabel(
        { key: key as never, label: null, required: false, preset: null },
        { roleLabels, definitions: scoped },
      );
    const info = (key: string): BuilderFieldInfo => {
      const fieldId = customFieldIdOfKey(key);
      if (fieldId) {
        const definition = byId.get(fieldId);
        if (!definition) return { label: b.unknownField, preview: 'input', unknown: true };
        return {
          label: definition.name,
          preview: previewOfFieldType(definition.type),
          multiline: definition.type === 'long_text',
          lockable: true,
        };
      }
      if (key === 'title' || key === 'plannedMinutes') {
        return { label: b.systemLabels[key], preview: 'input', lockable: true };
      }
      return {
        label: labelOf(key),
        preview: SYSTEM_PREVIEW[key] ?? 'input',
        multiline: key === 'description',
        lockable: true,
      };
    };
    const systemKeys = TASK_CREATION_SYSTEM_KEYS.filter(
      (key) => key !== 'project' || projectsAvailable(),
    );
    const attributeKeys = inType.map((entry) => customFieldKey(entry.id));
    const blocks: BuilderBlockOption[] = creationChipSchema.options.map((chip) => ({
      block: `chip:${chip}`,
      label: CHIP_LABEL[chip],
      preview: 'toggle',
      layout: false,
    }));
    const requiredHintOf = (field: { key: string; extra: CreationExtra }) =>
      !requiredAllowed(field.key as CreationFieldKey)
        ? c.requiredAlways
        : field.extra.preset !== null
          ? ui.automation.problems.creation_hidden_required
          : c.requiredHint;
    return {
      title: `${b.titles.creation} · ${type.name}`,
      info,
      catalog: [
        ...systemKeys.map((key) => ({ key, label: info(key).label, group: 'system' as const })),
        ...attributeKeys.map((key) => ({
          key,
          label: info(key).label,
          group: 'attribute' as const,
        })),
      ],
      makeField: creationField,
      blocks,
      makeBlock: (block) => creationBlock(block.replace('chip:', '') as CreationChip),
      renderBlock: (block) => <ChipPreview block={block} />,
      blockSettings: (block) => {
        const chip = block.block.replace('chip:', '') as CreationChip;
        return <p className="text-xs text-muted-foreground">{CHIP_HINT[chip]}</p>;
      },
      required: (field) => field.extra.required,
      badges: (field) => [
        ...(field.extra.preset !== null ? [b.badgeHidden] : []),
        ...(field.extra.formula ? [b.badgeFormula] : []),
      ],
      settings: (field, patch) => (
        <CreationFieldSettings
          field={field}
          definition={byId.get(customFieldIdOfKey(field.key) ?? '')}
          standardLabel={info(field.key).label}
          ownDefinitions={scoped}
          hostKind={type.category === 'letter' ? 'letter' : 'task'}
          readOnly={readOnly}
          requiredHint={requiredHintOf(field)}
          onFormula={(formula) => patch({ extra: { formula: formula ?? undefined } })}
          onRequired={(required) => patch({ extra: { required } })}
          onPreset={(preset) => patch({ extra: { preset } })}
        />
      ),
      lockMode: 'creation',
      lockable: [
        ...LOCKABLE_SYSTEM_KEYS.filter((key) => key !== 'project' || projectsAvailable()),
        ...attributeKeys,
      ].map((key) => ({ key, label: info(key).label })),
      fixedTop: (
        <CreationFixedRows
          typeName={type.name}
          titleFormula={titleFormula}
          ownDefinitions={scoped}
          hostKind={type.category === 'letter' ? 'letter' : 'task'}
          readOnly={readOnly}
          onChange={setTitleFormula}
        />
      ),
      limits: { fields: CREATION_FORM_LIMITS.fields, decor: CREATION_FORM_LIMITS.decor },
    };
  }, [type, scoped, readOnly, titleFormula, setTitleFormula]);
}
