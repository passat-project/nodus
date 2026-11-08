import { useMemo } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldModule,
  ProcessCategory,
  TransitionWindowField,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import {
  CUSTOM_FIELD_LIMITS,
  FORM_LAYOUT_LIMITS,
  LOCKABLE_SYSTEM_KEYS,
  bindingsOf,
  customFieldIdOfKey,
  customFieldKey,
  slotLabel,
  ui,
} from '@nodus/contracts';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import type {
  BuilderFieldInfo,
  FormBuilderHost,
  PreviewKind,
} from '../../../../../shared/forms/builder/builder-host.js';
import { FormBuilder } from '../../../../../shared/forms/builder/form-builder.js';
import { previewOfFieldType } from '../../../../../shared/forms/builder/preview-kind.js';
import { PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  transitionField,
  transitionFromBuilder,
  transitionToBuilder,
  type TransitionExtra,
} from '../../../model/transition-builder.js';
import { WINDOW_FIELDS } from '../../../model/transition-form.js';
import { validatorOf } from '../../../model/transition-rules.js';
import { WINDOW_SLOT_TYPES } from '../panel/window-field-formulas.js';
import { WindowSectionsControls } from '../panel/window-sections-controls.js';

const b = ui.forms.builder;

const SYSTEM_PREVIEW: Readonly<Record<string, PreviewKind>> = {
  deadline: 'date',
  plannedMinutes: 'number',
  description: 'text',
  assignee: 'people',
};

/**
 * Редактор окна кнопки (#496, В8) — вход из раздела «Окно при нажатии»:
 * раздел «Поля» с раскладкой и оформлением, формула-подстановка у поля
 * (#632), замки «после нажатия» и «Закрепить также». Остальные разделы окна
 * (время, итог, файлы, причина) — под полями, только показ: включаются в
 * панели кнопки. Поля условия «Заполнены поля», которых нет в окне, — тоже
 * показ («из условия перехода»).
 */
export function TransitionWindowBuilder({
  open,
  transition,
  scope,
  typeId,
  category,
  readOnly,
  onClose,
}: {
  open: boolean;
  transition: WorkflowDraftTransition;
  scope: CustomFieldModule;
  typeId?: string;
  category: ProcessCategory;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { data: definitions } = useCustomFieldDefinitions(scope);
  const scoped = useMemo(() => definitions ?? [], [definitions]);
  const value = useMemo(() => transitionToBuilder(transition.form), [transition.form]);
  const host = useTransitionHost(transition, scoped, typeId, category, readOnly);
  return (
    <FormBuilder
      open={open}
      host={host}
      value={value}
      readOnly={readOnly}
      onCancel={onClose}
      onDone={(next) => {
        useRouteDocStore.getState().patchTransition(transition.id, {
          form: transitionFromBuilder(transition.form, next),
        });
        onClose();
      }}
    />
  );
}

function useTransitionHost(
  transition: WorkflowDraftTransition,
  scoped: readonly CustomFieldDefinition[],
  typeId: string | undefined,
  category: ProcessCategory,
  readOnly: boolean,
): FormBuilderHost<TransitionExtra> {
  return useMemo(() => {
    const byId = new Map(scoped.map((entry) => [entry.id, entry]));
    const inType = scoped.filter(
      (entry) => !typeId || bindingsOf(entry).processTypeIds.includes(typeId),
    );
    const attributeKeys = inType.map((entry) => customFieldKey(entry.id));
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
        return {
          label: b.systemLabels[key],
          preview: SYSTEM_PREVIEW[key] ?? 'input',
          lockable: true,
        };
      }
      const label =
        key in ui.automation.requirableFields
          ? ui.automation.requirableFields[key as TransitionWindowField]
          : slotLabel({ key: key as never, label: null, required: false, preset: null });
      return {
        label,
        preview: SYSTEM_PREVIEW[key] ?? 'select',
        multiline: key === 'description',
        lockable: true,
      };
    };
    const hostKind = category === 'letter' ? 'letter' : 'task';
    return {
      title: `${b.titles.transition} «${transition.name || ui.automation.window.preview}»`,
      info,
      catalog: [...WINDOW_FIELDS, ...attributeKeys].map((key) => ({ key, label: info(key).label })),
      makeField: transitionField,
      badges: (field) => (field.extra.formula ? [b.badgeFormula] : []),
      settings: (field, patch) => {
        const definition = byId.get(customFieldIdOfKey(field.key) ?? '');
        const label = info(field.key).label;
        return (
          <PanelField label={ui.formulas.typeFormula.field} hint={ui.formulas.typeFormula.hint}>
            <TypeFormulaControl
              hostKind={hostKind}
              {...(definition
                ? { definition }
                : { targetType: WINDOW_SLOT_TYPES[field.key] ?? 'text', label })}
              ownDefinitions={scoped}
              value={field.extra.formula ?? null}
              readOnly={readOnly}
              allowRelated
              onChange={(ast) => patch({ extra: { formula: ast ?? undefined } })}
            />
          </PanelField>
        );
      },
      lockMode: 'transition',
      lockable: [
        ...LOCKABLE_SYSTEM_KEYS.filter((key) => key !== 'project' || projectsAvailable()),
        ...attributeKeys,
      ].map((key) => ({ key, label: info(key).label })),
      footer: (
        <>
          <TransitionFooter transition={transition} labelOf={(key) => info(key).label} />
          <WindowSectionsControls transition={transition} readOnly={readOnly} category={category} />
        </>
      ),
      limits: { fields: CUSTOM_FIELD_LIMITS.windowFields, decor: FORM_LAYOUT_LIMITS.decor },
    };
  }, [transition, scoped, typeId, category, readOnly]);
}

/** Под полями: остальные разделы окна и поля условия — только показ. */
function TransitionFooter({
  transition,
  labelOf,
}: {
  transition: WorkflowDraftTransition;
  labelOf: (key: string) => string;
}) {
  const configured = new Set(
    transitionToBuilder(transition.form)
      .items.filter((item) => item.kind === 'field')
      .map((item) => (item as { key: string }).key),
  );
  const gateOnly = (validatorOf(transition.rules, 'fields_required')?.fields ?? []).filter(
    (key) => !configured.has(key) && key !== 'result',
  );
  if (gateOnly.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 px-2 py-2 text-xs text-muted-foreground">
      {gateOnly.length > 0 ? (
        <p title={b.fromGateHint}>
          {b.fromGate}: {gateOnly.map(labelOf).join(', ')}
        </p>
      ) : null}
    </div>
  );
}
