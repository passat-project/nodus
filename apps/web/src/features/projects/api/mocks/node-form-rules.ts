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
import {
  demoCustomFieldDefinitions,
  demoFieldById,
} from '../../../../shared/mocks/data/custom-fields.js';

/**
 * Правила формы вида в мок-мире (#556, ревизия #631): те же помощники
 * контрактов, что у сервера (одна грамматика) — «чужой атрибут»,
 * обязательность при создании, смене вида и очистке. Код папки — обычный
 * слот атрибута «Код» (SYSTEM_FIELD_IDS.nodeCode), системного слота code
 * больше нет. Мок повторяет сервер (ADR-0001): отказ мока = отказ сервера.
 */

/** Эффективная форма вида: слоты существующих определений (зеркало
 *  серверного `effectiveNodeForm`); привязка — отдельный слой. */
export function formOfKind(kind: NodeKind): NodeKindForm {
  return effectiveNodeForm(kind, demoCustomFieldDefinitions);
}

export interface NodeRuleIssue {
  code:
    | 'PROJECT_NODE_FIELDS_REQUIRED'
    | 'PROJECT_NODE_KIND_FORM_INVALID'
    | 'CUSTOM_FIELD_VALUE_INVALID';
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
  // Сервер разрешает значение ПРИВЯЗАННОГО атрибута, даже если слота нет:
  // привязка = доступность, слот = видимость (Р3/#646).
  const bound = new Set(
    definitionsForTarget(demoCustomFieldDefinitions, 'node', kind.id).map(
      (definition) => definition.id,
    ),
  );
  const issues: { fieldId: string; reason: 'unknown' | 'not_in_type'; message: string }[] = [];
  for (const [fieldId, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (!demoFieldById(fieldId)) {
      issues.push({ fieldId, reason: 'unknown', message: 'Unknown custom field' });
    } else if (!bound.has(fieldId)) {
      issues.push({
        fieldId,
        reason: 'not_in_type',
        message: 'Field is not bound to this type',
      });
    }
  }
  if (issues.length === 0) return null;
  return {
    code: 'CUSTOM_FIELD_VALUE_INVALID',
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

/** Форма вида при PATCH: каждый слот — существующий атрибут портала, не
 *  глобальная переменная. Предварительная привязка НЕ требуется: сервер
 *  сам создаёт её из слота (`syncPlaceBindings`). */
export function kindFormIssues(
  _kind: NodeKind,
  form: NodeKindForm,
): { fieldId: string; reason: 'unknown_field' | 'not_bindable' }[] {
  const byId = new Map(demoCustomFieldDefinitions.map((definition) => [definition.id, definition]));
  const issues: { fieldId: string; reason: 'unknown_field' | 'not_bindable' }[] = [];
  for (const slot of form.fields) {
    const definition = byId.get(slot.fieldId);
    if (!definition) issues.push({ fieldId: slot.fieldId, reason: 'unknown_field' });
    else if (definition.isCompany) issues.push({ fieldId: slot.fieldId, reason: 'not_bindable' });
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
