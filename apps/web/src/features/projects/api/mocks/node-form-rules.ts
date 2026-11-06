import type {
  CustomFieldValue,
  CustomFieldValues,
  NodeKind,
  NodeKindForm,
  NodeFormKey,
} from '@nodus/contracts';
import {
  clearedNodeFields,
  effectiveNodeForm,
  missingNodeFields,
  nodeFormKey,
  requiredNodeFields,
} from '@nodus/contracts';

import { definitionsForTarget } from '../../../../shared/custom-fields/module-target.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';

/**
 * Правила формы вида в мок-мире (#556, ревизия #631): те же помощники
 * контрактов, что у сервера (одна грамматика) — «чужой атрибут»,
 * обязательность при создании, смене вида и очистке. Код папки — обычный
 * слот атрибута «Код» (SYSTEM_FIELD_IDS.nodeCode), системного слота code
 * больше нет. Мок повторяет сервер (ADR-0001): отказ мока = отказ сервера.
 */

/** Эффективная форма вида: слоты атрибутов, привязанных к этому виду (Р3). */
export function formOfKind(kind: NodeKind): NodeKindForm {
  return effectiveNodeForm(kind, definitionsForTarget(demoCustomFieldDefinitions, 'node', kind.id));
}

export interface NodeRuleIssue {
  code: 'PROJECT_NODE_FIELDS_REQUIRED' | 'PROJECT_NODE_KIND_FORM_INVALID' | 'VALIDATION_FAILED';
  status: 400 | 422;
  message: string;
  details: Record<string, unknown>;
}

/** Ошибка обязательных полей (422): `fields` — ключи `cf.<id>`. */
export function requiredIssue(
  kindId: string,
  fields: NodeFormKey[],
  reason: 'create' | 'kind_change' | 'clear',
): NodeRuleIssue {
  return {
    code: 'PROJECT_NODE_FIELDS_REQUIRED',
    status: 422,
    message: 'Required node fields are missing',
    details: { kindId, fields, reason },
  };
}

/** Значения атрибутов вне формы вида (не привязан к виду или не в слотах) —
 *  422 `not_in_type` (как `CUSTOM_FIELD_VALUE_INVALID` у сервера). */
export function foreignValueIssue(
  kind: NodeKind,
  values: Record<string, CustomFieldValue | null> | undefined,
): NodeRuleIssue | null {
  if (!values) return null;
  const inForm = new Set(formOfKind(kind).fields.map((slot) => slot.fieldId));
  const issues = Object.entries(values)
    .filter(([fieldId, value]) => value !== null && value !== undefined && !inForm.has(fieldId))
    .map(([fieldId]) => ({
      fieldId,
      reason: 'not_in_type' as const,
      message: 'Field is not bound to this type',
    }));
  if (issues.length === 0) return null;
  return {
    code: 'VALIDATION_FAILED',
    status: 422,
    message: 'Custom field value is invalid',
    details: { issues },
  };
}

/** Создание: обязательные слоты формы вида (код — как обычный слот) — 422 `create`. */
export function createIssues(
  kind: NodeKind,
  input: { customFields?: CustomFieldValues },
): NodeRuleIssue | null {
  const foreign = foreignValueIssue(kind, input.customFields);
  if (foreign) return foreign;
  const missing = missingNodeFields(formOfKind(kind), input);
  return missing.length > 0 ? requiredIssue(kind.id, missing, 'create') : null;
}

/** Правка: смена вида проверяет обязательные НОВОГО вида по `next`; очистка
 *  обязательного текущего вида — 422 `clear`. Значения прежнего вида не
 *  стираются (Р6). */
export function updateIssues(
  kind: NodeKind,
  current: { customFields: CustomFieldValues },
  patch: { customFields?: Record<string, CustomFieldValue | null> },
  kindChanged: boolean,
): NodeRuleIssue | null {
  const foreign = foreignValueIssue(kind, patch.customFields);
  if (foreign) return foreign;

  const next: CustomFieldValues = { ...current.customFields };
  for (const [fieldId, value] of Object.entries(patch.customFields ?? {})) {
    if (value === null) delete next[fieldId];
    else next[fieldId] = value;
  }
  const form = formOfKind(kind);
  if (kindChanged) {
    const missing = missingNodeFields(form, { customFields: next });
    return missing.length > 0 ? requiredIssue(kind.id, missing, 'kind_change') : null;
  }
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(patch.customFields ?? {}).map(([id, value]) => [nodeFormKey(id), value]),
  );
  const cleared = clearedNodeFields(requiredNodeFields(form), values);
  return cleared.length > 0 ? requiredIssue(kind.id, cleared, 'clear') : null;
}

/** Форма вида при PATCH: каждый слот — атрибут, привязанный к этому виду
 *  (иначе 422 `unknown_field`); привязка живёт в реестре («Где
 *  используется»), форма задаёт только состояния (Р3 #631). */
export function kindFormIssues(
  kind: NodeKind,
  form: NodeKindForm,
): { fieldId: string; reason: 'unknown_field' }[] {
  const bound = new Set(
    definitionsForTarget(demoCustomFieldDefinitions, 'node', kind.id).map(
      (definition) => definition.id,
    ),
  );
  return form.fields
    .filter((slot) => !bound.has(slot.fieldId))
    .map((slot) => ({ fieldId: slot.fieldId, reason: 'unknown_field' as const }));
}

export function kindFormInvalidIssue(
  fieldIds: { fieldId: string; reason: string }[],
): NodeRuleIssue {
  return {
    code: 'PROJECT_NODE_KIND_FORM_INVALID',
    status: 422,
    message: 'Node kind form is invalid',
    details: { fieldIds, reason: fieldIds[0]?.reason ?? 'unknown_field' },
  };
}
