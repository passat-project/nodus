import { HttpResponse } from 'msw';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { customFieldKey } from '@nodus/contracts';

import { dictionaryById } from '../../mocks/data/dictionaries.js';
import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { demoRefsForValues } from '../../mocks/data/custom-fields-refs.js';
import { demoLetters } from '../../mocks/data/letters.js';
import { demoNodeKinds, demoNodeRows } from '../../mocks/data/project-nodes.js';
import { demoProjectRows, demoProjectTypes } from '../../mocks/data/projects.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';
import { creationFormOf, mockTypes } from '../../mocks/data/process-types-store.js';

/** Утилиты мок-сервера реестра атрибутов (#631): сборка DTO с гидратацией
 *  справочника/ссылок, ошибки, поиск дубля имени, категории типов, проверка
 *  целей привязки и подсчёт носителей значения. Общие для хендлеров
 *  коллекции (`custom-fields-registry-handlers.ts`) и одного атрибута
 *  (`custom-fields-definition-handlers.ts`). */

function dto(definition: CustomFieldDefinition): CustomFieldDefinition {
  const dictionary = definition.settings.dictionaryId
    ? dictionaryById(definition.settings.dictionaryId)
    : definition.type === 'money' && definition.settings.currencyId
      ? dictionaryById('d1000000-0000-4000-8000-000000000001')
      : undefined;
  const defaultRefs =
    definition.defaultValue?.kind === 'static'
      ? demoRefsForValues({ [definition.id]: definition.defaultValue.value })
      : [];
  return {
    ...definition,
    defaultRefs,
    dictionary: dictionary
      ? {
          id: dictionary.id,
          code: dictionary.code,
          name: dictionary.name,
          isSystem: dictionary.isSystem,
        }
      : null,
  };
}

function error(code: string, message: string, status: number, details?: unknown) {
  return HttpResponse.json({ code, message, ...(details ? { details } : {}) }, { status });
}

function nameTaken(name: string, exceptId?: string) {
  const key = name.trim().toLowerCase();
  return demoCustomFieldDefinitions.find(
    (entry) => entry.id !== exceptId && entry.name.trim().toLowerCase() === key,
  );
}

/** Категории демо-типов процессов (для фильтра module=task|letter). */
function typeCategorySets() {
  const taskTypeIds = new Set(
    mockTypes.filter((type) => type.category === 'task').map((type) => type.id),
  );
  const letterTypeIds = new Set(
    mockTypes.filter((type) => type.category === 'letter').map((type) => type.id),
  );
  return { taskTypeIds, letterTypeIds };
}

/** Валидация цели привязки: типы процессов, типы проектов, виды папок. */
function bindingTargetExists(kind: string, targetId: string): boolean {
  switch (kind) {
    case 'process-type':
      return mockTypes.some((type) => type.id === targetId && type.archivedAt === null);
    case 'project-type':
      return demoProjectTypes.some((type) => type.id === targetId);
    case 'node-kind':
      return demoNodeKinds.some((kind_) => kind_.id === targetId);
    default:
      return false;
  }
}

/** Сущности со значением атрибута — по всем носителям значений. */
function entitiesWithValue(fieldId: string) {
  const task = [...demoTasks, ...Object.values(demoSubtasks).flat()].filter(
    (entry) => entry.customFields?.[fieldId] !== undefined,
  );
  const letter = demoLetters.filter((entry) => entry.customFields[fieldId] !== undefined);
  const project = demoProjectRows.filter((entry) => entry.customFields[fieldId] !== undefined);
  const node = demoNodeRows.filter((entry) => entry.customFields[fieldId] !== undefined);
  return { task, letter, project, node };
}

/** Формы создания типов, где атрибут стоит слотом. */
function formsUsingField(fieldId: string) {
  const key = customFieldKey(fieldId);
  return mockTypes
    .filter((type) => creationFormOf(type).fields.some((slot) => slot.key === key) === true)
    .map((type) => ({ kind: type.category as 'task' | 'letter', name: type.name }));
}

export {
  bindingTargetExists,
  dto,
  entitiesWithValue,
  error,
  formsUsingField,
  nameTaken,
  typeCategorySets,
};
