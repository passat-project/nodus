import { useMemo, type ReactNode } from 'react';
import type {
  CustomFieldDefinition,
  FieldFormState,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import { FORM_LAYOUT_LIMITS, ui } from '@nodus/contracts';

import { TypeFormulaControl } from '../custom-fields/formula/type-formula-control.js';
import { PanelField } from '../ui/panel/panel-kit.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import {
  attributeFieldKey,
  attributeFromBuilder,
  attributeToBuilder,
  fieldIdOfAttributeKey,
  systemKeyOfAttributeKey,
  type AttributeElement,
  type AttributeExtra,
} from './attribute-form-model.js';
import type { BuilderFieldInfo, FormBuilderHost, PreviewKind } from './builder/builder-host.js';
import type { BuilderField } from './builder/builder-model.js';
import { FormBuilder } from './builder/form-builder.js';
import { previewOfFieldType } from './builder/preview-kind.js';

const b = ui.forms.builder;

const FIELD_STATES: readonly FieldFormState[] = ['hidden', 'optional', 'required'];

export interface AttributeSystemInfo {
  label: string;
  preview: PreviewKind;
  multiline?: boolean;
}

/**
 * Редактор формы атрибутов (#496, единое ядро) для вида папки, типа проекта
 * и строки реестра: слоты атрибутов, системные строки и оформление — один
 * список с одними настройками (подпись, подсказка, ширина, высота). Своё
 * слота — состояние «Скрыто / По желанию / Обязательно» и формула.
 */
export function AttributeWindowBuilder({
  open,
  title,
  elements,
  definitions,
  systemInfo,
  formulaHostKind,
  fixedTop,
  readOnly,
  error,
  onCreateField,
  onDone,
  onClose,
}: {
  open: boolean;
  title: string;
  elements: readonly AttributeElement[];
  /** Атрибуты, доступные в палитре (привязанные к месту). */
  definitions: readonly CustomFieldDefinition[];
  /** Системные строки проекта: подписи и виды контролов. */
  systemInfo?: (key: string) => AttributeSystemInfo;
  formulaHostKind: FormulaHostKind;
  fixedTop?: ReactNode;
  readOnly: boolean;
  /** Ошибка сохранения — показывается под окном, редактор не закрывается. */
  error?: string | null;
  onCreateField?: () => void;
  onDone: (elements: AttributeElement[]) => void;
  onClose: () => void;
}) {
  const value = useMemo(() => attributeToBuilder(elements), [elements]);
  const host = useAttributeHost(
    title,
    definitions,
    systemInfo,
    formulaHostKind,
    fixedTop,
    readOnly,
    error,
    onCreateField,
  );
  return (
    <FormBuilder
      open={open}
      host={host}
      value={value}
      readOnly={readOnly}
      blockEmptyDecor
      onCancel={onClose}
      onDone={(next) => onDone(attributeFromBuilder(next))}
    />
  );
}

function useAttributeHost(
  title: string,
  definitions: readonly CustomFieldDefinition[],
  systemInfo: ((key: string) => AttributeSystemInfo) | undefined,
  formulaHostKind: FormulaHostKind,
  fixedTop: ReactNode,
  readOnly: boolean,
  error: string | null | undefined,
  onCreateField: (() => void) | undefined,
): FormBuilderHost<AttributeExtra> {
  return useMemo(() => {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const info = (key: string): BuilderFieldInfo => {
      const system = systemKeyOfAttributeKey(key);
      if (system !== null) {
        const entry = systemInfo?.(system);
        return {
          label: entry?.label ?? system,
          preview: entry?.preview ?? 'input',
          multiline: entry?.multiline,
          fixed: true,
          hideHint: true,
        };
      }
      const fieldId = fieldIdOfAttributeKey(key);
      const definition = fieldId ? byId.get(fieldId) : undefined;
      if (!definition) return { label: b.unknownField, preview: 'input', unknown: true };
      return {
        label: definition.name,
        preview: previewOfFieldType(definition.type),
        multiline: definition.type === 'long_text',
      };
    };
    return {
      title,
      info,
      catalog: definitions.map((definition) => ({
        key: attributeFieldKey(definition.id),
        label: definition.name,
      })),
      makeField: (key) => attributeField(key),
      required: (field) => field.extra.state === 'required',
      badges: (field) => (field.extra.state === 'hidden' ? [b.badgeHidden] : []),
      settings: (field, patch) => (
        <AttributeFieldSettings
          field={field}
          definition={byId.get(fieldIdOfAttributeKey(field.key) ?? '')}
          hostKind={formulaHostKind}
          ownDefinitions={definitions}
          readOnly={readOnly}
          onState={(state) => patch({ extra: { state } })}
          onFormula={(formula) => patch({ extra: { formula: formula ?? undefined } })}
        />
      ),
      lockMode: null,
      fixedTop,
      footer: error ? (
        <p role="alert" className="px-2 text-xs text-danger">
          {error}
        </p>
      ) : null,
      ...(onCreateField ? { onCreateField } : {}),
      limits: { fields: 30, decor: FORM_LAYOUT_LIMITS.decor },
    };
  }, [definitions, systemInfo, formulaHostKind, fixedTop, readOnly, error, onCreateField, title]);
}

function attributeField(key: string): BuilderField<AttributeExtra> {
  return {
    kind: 'field',
    key,
    label: null,
    hint: null,
    width: 'full',
    extra: { state: 'optional' },
  };
}

function AttributeFieldSettings({
  field,
  definition,
  hostKind,
  ownDefinitions,
  readOnly,
  onState,
  onFormula,
}: {
  field: BuilderField<AttributeExtra>;
  definition: CustomFieldDefinition | undefined;
  hostKind: FormulaHostKind;
  ownDefinitions: readonly CustomFieldDefinition[];
  readOnly: boolean;
  onState: (state: FieldFormState) => void;
  onFormula: (formula: FormulaNode | null) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{ui.nodeKinds.form.stateTitle}</p>
        <SegmentedControl<FieldFormState>
          value={field.extra.state ?? 'optional'}
          disabled={readOnly}
          layout="grid"
          className="w-full"
          options={FIELD_STATES.map((value) => ({
            value,
            label: ui.nodeKinds.form.state[value],
          }))}
          onChange={onState}
        />
        <p className="text-xs text-muted-foreground">{ui.nodeKinds.form.stateHint}</p>
      </div>
      {definition ? (
        <PanelField label={ui.formulas.typeFormula.field} hint={ui.formulas.typeFormula.hint}>
          <TypeFormulaControl
            hostKind={hostKind}
            definition={definition}
            ownDefinitions={ownDefinitions}
            value={field.extra.formula ?? null}
            readOnly={readOnly}
            allowRelated
            onChange={onFormula}
          />
        </PanelField>
      ) : null}
    </>
  );
}
