import type { CustomFieldDefinition, CustomFieldValue, CustomFieldValues } from '@nodus/contracts';
import { bindingsOf, customFieldValueSchemaOf } from '@nodus/contracts';

import { demoCounterpartyById } from './counterparties.js';
import {
  demoAuthorDepartment,
  demoCustomFieldDefinitions,
  demoFieldById,
} from './custom-fields.js';
import { dictionaryIds, itemById } from './dictionaries.js';
import { demoDepartments } from './departments.js';
import { demoNodeRows } from './project-nodes.js';
import { demoProjectRows } from './projects.js';
import { demoSubtasks, demoTasks } from './tasks.js';
import { demoLetters } from './letters.js';
import { demoUserListItems } from './users.js';

/** Правила значений в моке — те же, что у сервера (#431/#631, Р2/Р5):
 *  неизвестный атрибут, неверный тип, неактивная или недоступная ссылка.
 *  Мок обязан совпадать с API. Привязку к типу проверяет вызывающий
 *  (множество bound), здесь — грамматика и существование цели. */
export interface DemoFieldIssue {
  fieldId: string;
  reason: 'unknown' | 'invalid' | 'not_found' | 'inactive' | 'not_in_type';
  message: string;
}

/** id атрибутов, привязанных к типу процесса (#631): bound-сет мока —
 *  запись значения непривязанного атрибута сервер отвергает not_in_type. */
export function boundFieldIds(typeId: string): ReadonlySet<string> {
  return new Set(
    demoCustomFieldDefinitions
      .filter((definition) => bindingsOf(definition).processTypeIds.includes(typeId))
      .map((definition) => definition.id),
  );
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
    if (!definition) {
      issues.push({ fieldId, reason: 'unknown', message: 'Unknown custom field' });
      continue;
    }
    // Глобальная переменная — существующий атрибут, но у записей его нет:
    // сервер отвечает `not_in_type` (known, но не привязан к месту), а не
    // `unknown` (#646).
    if (definition.isCompany) {
      issues.push({ fieldId, reason: 'not_in_type', message: 'Field is not bound to this place' });
      continue;
    }
    // Непривязанный к типу — отдельная причина (сервер: not_in_type, #631).
    if (bound && !bound.has(fieldId)) {
      issues.push({ fieldId, reason: 'not_in_type', message: 'Field is not bound to this place' });
      continue;
    }
    const issue = checkValueIssue(definition, value, { allowRecordRefs: true });
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Виды ссылок на записи: умолчания и глобальные значения проверяются без
 *  актёра — сервер такие ссылки не принимает (`not_found`). */
const RECORD_REF_TYPES = new Set(['task', 'letter', 'node', 'project']);

/** Значение одного определения: грамматика + ссылки (#646). Для умолчаний и
 *  глобальных значений `allowRecordRefs: false` — как сервер без актёра. */
export function checkValueIssue(
  definition: Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>,
  value: CustomFieldValue,
  opts: { allowRecordRefs?: boolean } = {},
): DemoFieldIssue | null {
  if (!customFieldValueSchemaOf(definition).safeParse(value).success) {
    return {
      fieldId: definition.id,
      reason: 'invalid',
      message: 'Value does not match field type',
    };
  }
  if (!opts.allowRecordRefs && RECORD_REF_TYPES.has(definition.type)) {
    return {
      fieldId: definition.id,
      reason: 'not_found',
      message: 'Record not found or not visible',
    };
  }
  const reference = checkReference(definition, value);
  return reference ? { fieldId: definition.id, ...reference } : null;
}

function checkReference(
  definition: Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>,
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
    case 'department': {
      const department = demoDepartments.find((entry) => entry.id === value);
      if (!department) return { reason: 'not_found', message: 'Department not found' };
      return department.isActive ? null : { reason: 'inactive', message: 'Department is archived' };
    }
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
      // Валюта — элемент ИМЕННО системного справочника currency (Р10):
      // вариант чужого справочника значением денег не принимается.
      if (!currency || currency.dictionaryId !== dictionaryIds.currency) {
        return { reason: 'not_found', message: 'Currency not found' };
      }
      return currency.isActive ? null : { reason: 'inactive', message: 'Currency archived' };
    }
    case 'project':
      return demoProjectRows.some((entry) => entry.id === value)
        ? null
        : { reason: 'not_found', message: 'Project not found' };
    case 'counterparty': {
      const counterparty = demoCounterpartyById(String(value));
      // Архивный контрагент для сервера — «не найден» (activeRef → null):
      // значение на архивную цель не ставится.
      return counterparty && counterparty.archivedAt === null
        ? null
        : { reason: 'not_found', message: 'Counterparty not found' };
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
