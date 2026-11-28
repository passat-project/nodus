import type {
  CustomFieldDefinition,
  FolderListItem,
  LetterListItem,
  ListSystemField,
  MoneyValue,
  TaskListItem,
} from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

import type { ListRowValueExtractor } from './list-ext-query.js';

/**
 * Сырые значения полей строк (#435) — клиентское зеркало серверных выражений
 * группировки: ключ группы должен совпасть с серверным (uuid ссылки, ISO-момент,
 * число — числом, пусто — null), иначе строка не попадёт в свою группу.
 * Атрибуты — «как хранится»: числа/деньги — числом (float8 ключ сервера),
 * остальное — текстом (ISO-даты упорядочены, uuid — как есть).
 */

function attributeRaw(
  customFields: Record<string, unknown> | undefined,
  field: string,
): string | number | null {
  const id = customFieldIdOfKey(field);
  if (id === null) return null;
  const value = customFields?.[id];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') {
    const money = value as MoneyValue;
    return typeof money.amount === 'number' ? money.amount : JSON.stringify(value);
  }
  return String(value);
}

/** Задачи: системные поля — из DTO (createdAt в DTO нет — не группируется). */
export const taskRowValue: ListRowValueExtractor<TaskListItem> = (task, field: string) => {
  switch (field) {
    case 'number':
      return task.number;
    case 'title':
      return task.title;
    case 'stage':
      return task.stage.id;
    case 'deadline':
      return task.deadline;
    case 'assignee':
      return task.assignee?.id ?? null;
    case 'type':
      return task.type.id;
    case 'project':
      return task.project?.id ?? null;
    case 'folder':
      return task.nodeId;
    case 'decidedBy':
      return task.decidedBy?.id ?? null;
    case 'decidedAt':
      return task.decidedAt ?? null;
    default:
      return attributeRaw(task.customFields, field);
  }
};

/** Письма: соответствие колонок контракта полям DTO писем. */
export const letterRowValue: ListRowValueExtractor<LetterListItem> = (letter, field: string) => {
  switch (field) {
    case 'regNumber':
      return letter.regNumber;
    case 'correspondent':
      return letter.counterparty?.id ?? null;
    case 'sentAt':
      return letter.theirDate;
    case 'assignee':
      return letter.addressee?.id ?? null;
    case 'type':
      return letter.typeId;
    case 'project':
      return letter.project?.id ?? null;
    case 'stage':
      return letter.stage.id;
    default:
      return attributeRaw(letter.customFields, field);
  }
};

/** Папки проекта (FolderListItem). */
export const folderRowValue: ListRowValueExtractor<FolderListItem> = (folder, field: string) => {
  switch (field) {
    case 'name':
      return folder.name;
    case 'kind':
      return folder.kindId;
    case 'createdAt':
      return folder.createdAt;
    default:
      return attributeRaw(folder.customFields, field);
  }
};

/** Определение атрибута по ключу поля (cf.<uuid>). */
export function definitionOfField(
  definitions: readonly CustomFieldDefinition[],
  field: string,
): CustomFieldDefinition | undefined {
  const id = customFieldIdOfKey(field);
  return id === null ? undefined : definitions.find((d) => d.id === id);
}

export type { ListSystemField };
