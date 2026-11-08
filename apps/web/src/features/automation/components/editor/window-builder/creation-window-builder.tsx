import { useMemo } from 'react';
import type { CreationForm, CustomFieldDefinition, ProcessType } from '@nodus/contracts';
import {
  CREATION_FORM_LIMITS,
  LOCKABLE_SYSTEM_KEYS,
  TASK_CREATION_SYSTEM_KEYS,
  bindingsOf,
  customFieldIdOfKey,
  customFieldKey,
  slotLabel,
  typeConfigOf,
  ui,
} from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { FormBuilder } from '../../../../../shared/forms/builder/form-builder.js';
import type {
  BuilderFieldInfo,
  FormBuilderHost,
  PreviewKind,
} from '../../../../../shared/forms/builder/builder-host.js';
import { previewOfFieldType } from '../../../../../shared/forms/builder/preview-kind.js';
import { PreviewControl } from '../../../../../shared/forms/builder/preview-control.js';
import {
  creationField,
  creationFromBuilder,
  creationToBuilder,
  type CreationExtra,
} from '../../../model/creation-builder.js';
import { withSlotPatched } from '../../../model/creation-form.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { CreationSlotSection } from '../panel/creation-slot-section.js';

const b = ui.forms.builder;

const SYSTEM_PREVIEW: Readonly<Record<string, PreviewKind>> = {
  description: 'text',
  assignee: 'people',
  coexecutors: 'people',
  observers: 'people',
  deadline: 'date',
  priority: 'select',
  project: 'select',
};

/**
 * Редактор окна создания (#496, В8) — вход из панели «Окно создания»:
 * общий редактор окна + своё окна создания (обязательность, скрытое
 * значение, формула слота — тот же раздел, что в панели) и замки «после
 * создания». «Готово» — одна правка документа маршрута (история, черновик,
 * публикация — как у статусов и кнопок).
 */
export function CreationWindowBuilder({
  open,
  type,
  form,
  readOnly,
  onClose,
}: {
  open: boolean;
  type: ProcessType;
  form: CreationForm;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { data: definitions } = useCustomFieldDefinitions(type.category);
  const scoped = useMemo(() => definitions ?? [], [definitions]);
  const value = useMemo(() => creationToBuilder(form), [form]);
  const host = useCreationHost(type, scoped, readOnly);
  return (
    <FormBuilder
      open={open}
      host={host}
      value={value}
      readOnly={readOnly}
      onCancel={onClose}
      onDone={(next) => {
        useRouteDocStore.getState().setCreationForm(creationFromBuilder(form, next));
        onClose();
      }}
    />
  );
}

function useCreationHost(
  type: ProcessType,
  scoped: readonly CustomFieldDefinition[],
  readOnly: boolean,
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
    return {
      title: `${b.titles.creation} · ${type.name}`,
      info,
      catalog: [...systemKeys, ...attributeKeys].map((key) => ({ key, label: info(key).label })),
      makeField: creationField,
      required: (field) => field.extra.required,
      badges: (field) => [
        ...(field.extra.preset !== null ? [b.badgeHidden] : []),
        ...(field.extra.formula ? [b.badgeFormula] : []),
      ],
      settings: (field, patch) => {
        const definition = byId.get(customFieldIdOfKey(field.key) ?? '');
        const slot = {
          key: field.key as never,
          label: field.label,
          ...field.extra,
        };
        return (
          <CreationSlotSection
            compact
            slot={slot}
            standardLabel={info(field.key).label}
            definition={definition}
            ownDefinitions={scoped}
            hostKind={type.category === 'letter' ? 'letter' : 'task'}
            presetLabel={null}
            problems={[]}
            readOnly={readOnly}
            onChange={(slotPatch) => {
              const next = withSlotPatched({ fields: [slot], chips: [] }, slot.key, slotPatch)
                .fields[0] as typeof slot;
              patch({
                extra: { required: next.required, preset: next.preset, formula: next.formula },
              });
            }}
            onRemove={() => {}}
          />
        );
      },
      lockMode: 'creation',
      lockable: [
        ...LOCKABLE_SYSTEM_KEYS.filter((key) => key !== 'project' || projectsAvailable()),
        ...attributeKeys,
      ].map((key) => ({ key, label: info(key).label })),
      fixedTop: <CreationFixedRows typeName={type.name} />,
      limits: { fields: CREATION_FORM_LIMITS.fields, decor: CREATION_FORM_LIMITS.decor },
    };
  }, [type, scoped, readOnly]);
}

/** Неподвижные строки окна создания: название и тип — всегда первыми. */
function CreationFixedRows({ typeName }: { typeName: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 px-2" title={b.fixedRow}>
      <span className="flex h-9 min-w-0 items-center rounded-lg border border-input px-2.5 text-body-lg text-muted-foreground dark:bg-input/30">
        {ui.taskCreate.titlePlaceholder}
      </span>
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
