import { PROJECT_AUDIENCE_EVENTS } from '@nodus/contracts';

import { projectsKeys } from '../api/projects-list.js';
import { tasksKeys } from '../api/tasks-keys.js';
import type { KeyBatcher } from './invalidation-batcher.js';

/** Адресные события проекта (#646): gateway доставляет их только участникам
 *  (payload.audience), клиент перечитывает журналы, карточку, состав,
 *  историю и дерево. Имя/шифр секретного проекта в общий presence не уходит.
 *  `node_updated` (#632): правка атрибутов папки меняет значения формул
 *  наследников — без перечитывания списков они живут до F5. */
const PROJECT_EVENTS = new Set<string>(PROJECT_AUDIENCE_EVENTS);

/** Ключи кэша по `project.created/updated/participants_changed`. true —
 *  событие обработано здесь, false — не наше (роутер пробует дальше). */
export function pushProjectKeys(
  batcher: KeyBatcher,
  type: string,
  payload: Record<string, unknown>,
): boolean {
  if (!PROJECT_EVENTS.has(type)) return false;
  // Журнал и пикеры — префиксами: параметры фильтра у каждого клиента свои.
  batcher.push(projectsKeys.journals(), 'list');
  batcher.push(projectsKeys.options(), 'list');
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : null;
  if (projectId) {
    batcher.push(projectsKeys.detail(projectId), 'list');
    batcher.push(projectsKeys.members(projectId), 'list');
    batcher.push(projectsKeys.history(projectId), 'list');
    batcher.push(projectsKeys.structure(projectId), 'list');
  }
  // Правка атрибутов проекта/папки меняет формульные значения записей-
  // наследников (шифры читают атрибуты папки/проекта): списки задач и канбан
  // перечитываются — свежесть без F5 (#632). Событие редкое; точечно
  // адресовать записи неоткуда (on-read формулы без dep-таблицы).
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  if (fields.some((field) => typeof field === 'string' && field.startsWith('cf.'))) {
    batcher.push(tasksKeys.listPages(), 'list');
    batcher.push(tasksKeys.kanbanAll(), 'list');
  }
  return true;
}
