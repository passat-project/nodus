import type { CustomFieldValue } from '@nodus/contracts';

import type { CustomFieldIssue, DefinitionFacts } from './value-validator.js';

/** Сверка одного значения с фактами портов (#431/Р2): вынесено из
 *  CustomFieldValueValidator ради лимита строк файла (I5); факты
 *  собирает checkReferences валидатора пачками по виду ссылки. */
export interface ReferenceFacts {
  scalarIds: (value: CustomFieldValue) => string[];
  knownUsers: ReadonlySet<string>;
  activeUsers: ReadonlySet<string>;
  departmentById: ReadonlyMap<string, { id: string; name: string; isActive: boolean }>;
  itemById: ReadonlyMap<
    string,
    { id: string; dictionaryId: string; name: string; isActive: boolean }
  >;
  currencyById: ReadonlyMap<
    string,
    { id: string; dictionaryId: string; name: string; isActive: boolean }
  >;
  activeCounterparties: ReadonlySet<string>;
  visibleProjects: ReadonlySet<string>;
  visibleTasks: ReadonlySet<string>;
  visibleLetters: ReadonlySet<string>;
  visibleNodes: ReadonlySet<string>;
}

/** Сверка одного значения с фактами портов. */
export function checkOne(
  input: {
    definition: DefinitionFacts;
    value: CustomFieldValue;
  } & ReferenceFacts,
): Pick<CustomFieldIssue, 'reason' | 'message'> | null {
  const { definition, value, scalarIds } = input;
  switch (definition.type) {
    case 'user':
    case 'users': {
      const ids = scalarIds(value);
      if (!ids.every((id) => input.knownUsers.has(id))) {
        return { reason: 'not_found', message: 'User not found' };
      }
      return ids.every((id) => input.activeUsers.has(id))
        ? null
        : { reason: 'inactive', message: 'User is deactivated' };
    }
    case 'department': {
      const department = input.departmentById.get(String(value));
      if (!department) return { reason: 'not_found', message: 'Department not found' };
      return department.isActive ? null : { reason: 'inactive', message: 'Department is archived' };
    }
    case 'enum':
    case 'multienum': {
      for (const id of scalarIds(value)) {
        const item = input.itemById.get(id);
        if (!item || item.dictionaryId !== definition.settings.dictionaryId) {
          return { reason: 'not_found', message: 'Dictionary item not found' };
        }
        if (!item.isActive) return { reason: 'inactive', message: 'Dictionary item archived' };
      }
      return null;
    }
    case 'money': {
      const currency = input.currencyById.get((value as { currencyId: string }).currencyId);
      if (!currency) return { reason: 'not_found', message: 'Currency not found' };
      return currency.isActive ? null : { reason: 'inactive', message: 'Currency archived' };
    }
    case 'project':
      // Видимый актёру проект (открытый/участие/view_secret; #52 Р13) —
      // без оракула секретности: скрытый = несуществующий.
      return input.visibleProjects.has(String(value))
        ? null
        : { reason: 'not_found', message: 'Project not found or not visible' };
    case 'task':
      // Существует, не удалена; конфиденциальная — участник (Р5 #631).
      return input.visibleTasks.has(String(value))
        ? null
        : { reason: 'not_found', message: 'Task not found or not visible' };
    case 'letter':
      return input.visibleLetters.has(String(value))
        ? null
        : { reason: 'not_found', message: 'Letter not found or not visible' };
    case 'node':
      // Узел существует и проект виден актёру (критерий project-значений).
      return input.visibleNodes.has(String(value))
        ? null
        : { reason: 'not_found', message: 'Node not found or not visible' };
    case 'counterparty':
      return input.activeCounterparties.has(String(value))
        ? null
        : { reason: 'not_found', message: 'Counterparty not found or archived' };
    default:
      return null;
  }
}
