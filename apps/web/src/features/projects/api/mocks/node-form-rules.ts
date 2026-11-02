import type {
  CustomFieldValue,
  CustomFieldValues,
  NodeKind,
  NodeKindForm,
  NodeKindFormField,
  NodeFormKey,
} from '@nodus/contracts';
import {
  clearedNodeFields,
  effectiveNodeForm,
  missingNodeFields,
  nodeFormKey,
  requiredNodeFields,
} from '@nodus/contracts';

import {
  demoCustomFieldDefinitions,
  demoFieldById,
} from '../../../../shared/mocks/data/custom-fields.js';

/**
 * Правила формы вида в мок-мире (#556): те же помощники контрактов, что у
 * сервера (одна грамматика) — «чужой атрибут», обязательность при создании,
 * смене вида и очистке, скрытое определение в форме. Мок повторяет сервер
 * (ADR-0001): отказ мока = отказ сервера.
 */

const nodeDefinitions = () => demoCustomFieldDefinitions.filter((entry) => entry.scope === 'node');

/** Эффективная форма вида: без неизвестных и скрытых определений. */
export function formOfKind(kind: NodeKind): NodeKindForm {
  return effectiveNodeForm(kind, nodeDefinitions());
}

export interface NodeRuleIssue {
  code: 'PROJECT_NODE_FIELDS_REQUIRED' | 'PROJECT_NODE_KIND_FORM_INVALID' | 'VALIDATION_FAILED';
  status: 400 | 422;
  message: string;
  details: Record<string, unknown>;
}

/** Ошибка обязательных полей (422): `fields` — `code` и `cf.<id>`. */
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

/** Значения существующих атрибутов области «Папка» вне формы вида — 422
 *  `not_in_type` (как `CUSTOM_FIELD_VALUE_INVALID` у сервера). */
export function foreignValueIssue(
  kind: NodeKind,
  values: Record<string, CustomFieldValue | null> | undefined,
): NodeRuleIssue | null {
  if (!values) return null;
  const inForm = new Set(formOfKind(kind).fields.map((slot) => slot.fieldId));
  const issues = Object.entries(values)
    .filter(([fieldId, value]) => {
      if (value === null || value === undefined) return false;
      const definition = demoFieldById(fieldId);
      return definition?.scope === 'node' && !inForm.has(fieldId);
    })
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

/** Шифр у вида со состоянием «скрыто» — 400 (поле не показывается, Р6). */
export function hiddenCodeIssue(
  kind: NodeKind,
  code: string | null | undefined,
): NodeRuleIssue | null {
  if (formOfKind(kind).code !== 'hidden' || code === undefined || code === null) return null;
  return {
    code: 'VALIDATION_FAILED',
    status: 400,
    message: 'Code is hidden for this kind',
    details: { kindId: kind.id },
  };
}

/** Создание: обязательные формы вида (шифр + атрибуты) — 422 `create`. */
export function createIssues(
  kind: NodeKind,
  input: { code?: string | null; customFields?: CustomFieldValues },
): NodeRuleIssue | null {
  const hidden = hiddenCodeIssue(kind, input.code);
  if (hidden) return hidden;
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
  current: { code: string | null; customFields: CustomFieldValues },
  patch: { code?: string | null; customFields?: Record<string, CustomFieldValue | null> },
  kindChanged: boolean,
): NodeRuleIssue | null {
  const hidden = hiddenCodeIssue(kind, patch.code);
  if (hidden) return hidden;
  const foreign = foreignValueIssue(kind, patch.customFields);
  if (foreign) return foreign;

  const next: CustomFieldValues = { ...current.customFields };
  for (const [fieldId, value] of Object.entries(patch.customFields ?? {})) {
    if (value === null) delete next[fieldId];
    else next[fieldId] = value;
  }
  const nextCode = patch.code !== undefined ? patch.code : current.code;
  const form = formOfKind(kind);
  if (kindChanged) {
    const missing = missingNodeFields(form, { code: nextCode, customFields: next });
    return missing.length > 0 ? requiredIssue(kind.id, missing, 'kind_change') : null;
  }
  const required = requiredNodeFields(form);
  const values: Record<string, unknown> = {
    ...Object.fromEntries(
      Object.entries(patch.customFields ?? {}).map(([id, value]) => [nodeFormKey(id), value]),
    ),
    ...(patch.code !== undefined ? { code: patch.code } : {}),
  };
  const cleared = clearedNodeFields(required, values);
  return cleared.length > 0 ? requiredIssue(kind.id, cleared, 'clear') : null;
}

/** Форма вида при PATCH: каждый fieldId — определение области «Папка»
 *  (иначе 422 `unknown_field`); скрытое определение допустимо только в
 *  состоянии «скрыто» и только для НОВОГО слота/смены состояния
 *  (`hidden_field`), существующий слот сохраняется как есть (Р7). */
export function kindFormIssues(
  form: NodeKindForm,
  previous: NodeKindForm | null,
): { fieldId: string; reason: 'unknown_field' | 'hidden_field' }[] {
  const issues: { fieldId: string; reason: 'unknown_field' | 'hidden_field' }[] = [];
  const before = new Map((previous?.fields ?? []).map((slot) => [slot.fieldId, slot.state]));
  for (const slot of form.fields as NodeKindFormField[]) {
    const definition = demoFieldById(slot.fieldId);
    if (!definition || definition.scope !== 'node') {
      issues.push({ fieldId: slot.fieldId, reason: 'unknown_field' });
      continue;
    }
    if (definition.hidden && slot.state !== 'hidden' && before.get(slot.fieldId) !== slot.state) {
      issues.push({ fieldId: slot.fieldId, reason: 'hidden_field' });
    }
  }
  return issues;
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
