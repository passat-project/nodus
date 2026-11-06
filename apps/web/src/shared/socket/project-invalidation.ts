import { PROJECT_AUDIENCE_EVENTS } from '@nodus/contracts';

import { projectsKeys } from '../api/projects-list.js';
import type { KeyBatcher } from './invalidation-batcher.js';

/** Адресные события проекта (#646): gateway доставляет их только участникам
 *  (payload.audience), клиент перечитывает журналы, карточку, состав,
 *  историю и дерево. Имя/шифр секретного проекта в общий presence не уходит. */
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
  return true;
}
