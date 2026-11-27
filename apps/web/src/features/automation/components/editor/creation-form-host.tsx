import { useMemo } from 'react';
import type {
  CreationChip,
  CreationFieldKey,
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

import { projectsAvailable } from '../../../../shared/api/projects-available.js';
import type {
  BuilderBlockOption,
  BuilderFieldInfo,
  FormBuilderHost,
} from '../../../../shared/forms/builder/builder-host.js';
import { previewOfFieldType } from '../../../../shared/forms/builder/preview-kind.js';
import {
  CHIP_HINT,
  CHIP_LABEL,
  ChipPreview,
  CreationFieldSettings,
  CreationFixedRows,
  SYSTEM_PREVIEW,
} from './window-builder/creation-window-parts.js';
import { creationBlock, creationField, type CreationExtra } from '../../model/creation-builder.js';

const b = ui.forms.builder;
const c = ui.automation.creation;

/**
 * Построитель формы создания типа задачи и письма (#496, единое ядро): поля,
 * атрибуты и блоки окна — один список с одними настройками: подпись, подсказка,
 * обязательность, скрытое значение, формула, замок. Название и тип —
 * неподвижный верх окна; формула названия (#632) — в настройках названия.
 * Рисует его вкладка «Форма создания» (#857, единая модель «Процессов») —
 * общим телом `FormBuilderBody`; сам построитель не знает, куда уходят правки.
 */
export function useCreationHost(
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
          onPreset={(preset) =>
            // Скрытое значение снимает обязательность в ТОЙ ЖЕ правке: два
            // отдельных patch из одного обработчика теряли первый (черновик
            // редактора правится одним шагом).
            patch({ extra: preset === null ? { preset } : { preset, required: false } })
          }
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
