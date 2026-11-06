import type { CustomFieldRef, CustomFieldValues } from '@nodus/contracts';
import { isCustomFieldValueFilled } from '@nodus/contracts';

import { demoCounterpartyById } from './counterparties.js';
import { demoFieldById } from './custom-fields.js';
import { itemById } from './dictionaries.js';
import { demoDepartments } from './departments.js';
import { demoLetters } from './letters.js';
import { demoNodeRows } from './project-nodes.js';
import { projectRefs } from './task-item-factory.js';
import { demoTasks } from './task-items.js';
import { demoUserListItems } from './users.js';

/** Ссылки для показа значений (Р6): сотрудники, подразделения, элементы
 *  справочников (включая валюту денег), проекты, контрагенты. Собираются
 *  из тех же демо-справочников, что и валидатор, — мок-мир один. */
export function demoRefsForValues(values: CustomFieldValues): CustomFieldRef[] {
  const refs = new Map<string, CustomFieldRef>();
  const add = (ref: CustomFieldRef) => refs.set(`${ref.kind}:${ref.id}`, ref);

  for (const [fieldId, value] of Object.entries(values)) {
    const definition = demoFieldById(fieldId);
    if (!definition || !isCustomFieldValueFilled(value)) continue;
    switch (definition.type) {
      case 'user':
      case 'users': {
        const ids = Array.isArray(value) ? value : [String(value)];
        for (const id of ids) {
          const user = demoUserListItems.find((entry) => entry.id === id);
          if (user) {
            add({
              kind: 'user',
              id,
              name: user.displayName,
              avatarUrl: user.avatarUrl,
              archived: user.status !== 'active',
            });
          }
        }
        break;
      }
      case 'department': {
        const department = demoDepartments.find((entry) => entry.id === value);
        if (department) {
          add({
            kind: 'department',
            id: department.id,
            name: department.name,
            avatarUrl: null,
            archived: !department.isActive,
          });
        }
        break;
      }
      case 'enum':
      case 'multienum': {
        const ids = Array.isArray(value) ? value : [String(value)];
        for (const id of ids) {
          const entry = itemById(id);
          if (entry) {
            add({
              kind: 'dictionary_item',
              id: entry.id,
              name: entry.name,
              avatarUrl: null,
              archived: !entry.isActive,
              color: entry.color,
            });
          }
        }
        break;
      }
      case 'money': {
        const money = value as { currencyId?: string };
        const currency = money.currencyId ? itemById(money.currencyId) : undefined;
        if (currency) {
          add({
            kind: 'dictionary_item',
            id: currency.id,
            name: currency.name,
            avatarUrl: null,
            archived: !currency.isActive,
            color: currency.color,
          });
        }
        break;
      }
      case 'project': {
        const project = Object.values(projectRefs).find((entry) => entry.id === value);
        if (project) {
          add({
            kind: 'project',
            id: project.id,
            name: project.name,
            avatarUrl: null,
            archived: false,
          });
        }
        break;
      }
      case 'counterparty': {
        const counterparty = demoCounterpartyById(String(value));
        if (counterparty) {
          add({
            kind: 'counterparty',
            id: counterparty.id,
            name: counterparty.shortName,
            avatarUrl: null,
            archived: counterparty.archivedAt !== null,
          });
        }
        break;
      }
      case 'task': {
        const task = demoTasks.find((entry) => entry.id === value);
        if (task) {
          add({
            kind: 'task',
            id: task.id,
            name: task.title,
            avatarUrl: null,
            archived: false,
          });
        }
        break;
      }
      case 'letter': {
        const letter = demoLetters.find((entry) => entry.id === value);
        if (letter) {
          add({
            kind: 'letter',
            id: letter.id,
            name: [letter.regNumber ?? '—', letter.counterparty?.name ?? '']
              .filter((part) => part !== '')
              .join(' · '),
            avatarUrl: null,
            archived: false,
          });
        }
        break;
      }
      case 'node': {
        const node = demoNodeRows.find((entry) => entry.id === value);
        if (node) {
          add({
            kind: 'node',
            id: node.id,
            name: node.name,
            avatarUrl: null,
            archived: false,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return [...refs.values()];
}
