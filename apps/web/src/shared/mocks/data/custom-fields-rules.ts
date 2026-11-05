import type { CustomFieldDefinition, CustomFieldValue, CustomFieldValues } from '@nodus/contracts';
import { customFieldValueSchemaOf } from '@nodus/contracts';

import { demoCounterpartyById } from './counterparties.js';
import {
  demoAuthorDepartment,
  demoCustomFieldDefinitions,
  demoFieldById,
} from './custom-fields.js';
import { itemById } from './dictionaries.js';
import { demoDepartments } from './departments.js';
import { demoNodeRows } from './project-nodes.js';
import { projectRefs } from './task-item-factory.js';
import { demoSubtasks, demoTasks } from './tasks.js';
import { demoLetters } from './letters.js';
import { demoUserListItems } from './users.js';

/** Правила значений в моке — те же, что у сервера (#431/#631, Р2/Р5):
 *  неизвестный атрибут, неверный тип, неактивная или недоступная ссылка.
 *  Мок обязан совпадать с API. Привязку к типу проверяет вызывающий
 *  (множество bound), здесь — грамматика и существование цели. */
export interface DemoFieldIssue {
  fieldId: string;
  reason: 'unknown' | 'invalid' | 'not_found' | 'inactive';
  message: string;
}

export function checkDemoValues(
  values: CustomFieldValues,
  bound?: ReadonlySet<string>,
): DemoFieldIssue[] {
  const issues: DemoFieldIssue[] = [];
  if (Object.keys(values).length > 50) {
    return [{ fieldId: '', reason: 'invalid', message: 'more than 50 fields' }];
  }
  for (const [fieldId, value] of Object.entries(values)) {
    const definition = demoFieldById(fieldId);
    if (!definition || definition.isCompany || (bound && !bound.has(fieldId))) {
      issues.push({ fieldId, reason: 'unknown', message: 'Unknown custom field' });
      continue;
    }
    if (!customFieldValueSchemaOf(definition).safeParse(value).success) {
      issues.push({ fieldId, reason: 'invalid', message: 'Value does not match field type' });
      continue;
    }
    const reference = checkReference(definition, value);
    if (reference) issues.push({ fieldId, ...reference });
  }
  return issues;
}

function checkReference(
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
): Pick<DemoFieldIssue, 'reason' | 'message'> | null {
  const ids = Array.isArray(value) ? value : null;
  switch (definition.type) {
    case 'user':
    case 'users': {
      const list = ids ?? [String(value)];
      const active = new Set(
        demoUserListItems.filter((user) => user.status === 'active').map((user) => user.id),
      );
      const known = new Set(demoUserListItems.map((user) => user.id));
      if (!list.every((id) => known.has(id))) {
        return { reason: 'not_found', message: 'User not found' };
      }
      return list.every((id) => active.has(id))
        ? null
        : { reason: 'inactive', message: 'User is deactivated' };
    }
    case 'department':
      return demoDepartments.some((entry) => entry.id === value && entry.isActive)
        ? null
        : { reason: 'not_found', message: 'Department not found' };
    case 'enum':
    case 'multienum': {
      const list = ids ?? [String(value)];
      for (const id of list) {
        const entry = itemById(id);
        if (!entry || entry.dictionaryId !== definition.settings.dictionaryId) {
          return { reason: 'not_found', message: 'Dictionary item not found' };
        }
        if (!entry.isActive) return { reason: 'inactive', message: 'Dictionary item archived' };
      }
      return null;
    }
    case 'money': {
      const money = value as { currencyId?: string };
      const currency = money.currencyId ? itemById(money.currencyId) : undefined;
      if (!currency) return { reason: 'not_found', message: 'Currency not found' };
      return currency.isActive ? null : { reason: 'inactive', message: 'Currency archived' };
    }
    case 'project':
      return Object.values(projectRefs).some((entry) => entry.id === value)
        ? null
        : { reason: 'not_found', message: 'Project not found' };
    case 'counterparty': {
      const counterparty = demoCounterpartyById(String(value));
      if (!counterparty) return { reason: 'not_found', message: 'Counterparty not found' };
      if (counterparty.archivedAt !== null) {
        return { reason: 'inactive', message: 'Counterparty archived' };
      }
      return null;
    }
    case 'task': {
      const known = [...demoTasks, ...Object.values(demoSubtasks).flat()].some(
        (task) => task.id === value,
      );
      return known ? null : { reason: 'not_found', message: 'Task not found' };
    }
    case 'letter':
      return demoLetters.some((letter) => letter.id === value)
        ? null
        : { reason: 'not_found', message: 'Letter not found' };
    case 'node':
      return demoNodeRows.some((node) => node.id === value)
        ? null
        : { reason: 'not_found', message: 'Node not found' };
    default:
      return null;
  }
}

/** Патч значений: `null` удаляет ключ, проверяются только изменившиеся (Р2). */
export function applyDemoPatch(
  current: CustomFieldValues,
  patch: Record<string, CustomFieldValue | null>,
  bound?: ReadonlySet<string>,
): { next: CustomFieldValues; issues: DemoFieldIssue[] } {
  const changed: CustomFieldValues = {};
  for (const [fieldId, value] of Object.entries(patch)) {
    if (value === null) continue;
    if (JSON.stringify(current[fieldId]) !== JSON.stringify(value)) changed[fieldId] = value;
  }
  const issues = checkDemoValues(changed, bound);
  const next: CustomFieldValues = { ...current };
  for (const [fieldId, value] of Object.entries(patch)) {
    if (value === null) delete next[fieldId];
    else if (!issues.some((issue) => issue.fieldId === fieldId)) next[fieldId] = value;
  }
  return { next, issues };
}

/** Умолчания при создании: статическое значение и «подразделение автора»;
 *  явное значение важнее (Р5). Невалидное умолчание тихо пропускается.
 *  `bound` — id атрибутов, привязанных к типу создаваемой записи (#432):
 *  умолчания непривязанных атрибутов не подставляются. */
export function demoDefaults(
  input: CustomFieldValues,
  bound: ReadonlySet<string>,
): CustomFieldValues {
  const values: CustomFieldValues = {};
  for (const definition of demoCustomFieldDefinitions) {
    if (definition.isCompany) continue;
    if (!bound.has(definition.id)) continue;
    if (definition.defaultValue === null) continue;
    if (input[definition.id] !== undefined) continue;
    if (definition.defaultValue.kind === 'author_department') {
      values[definition.id] = demoAuthorDepartment();
    } else if (
      customFieldValueSchemaOf(definition).safeParse(definition.defaultValue.value).success
    ) {
      values[definition.id] = definition.defaultValue.value;
    }
  }
  return { ...values, ...input };
}
