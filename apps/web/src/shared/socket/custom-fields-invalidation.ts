import type { QueryClient } from '@tanstack/react-query';
import { CUSTOM_FIELD_CATALOG_EVENTS, DICTIONARY_CATALOG_EVENTS } from '@nodus/contracts';

import { customFieldsKeys } from '../custom-fields/queries.js';
import { dictionariesKeys } from '../dictionaries/keys.js';
import { nodeKindsKeys } from '../api/node-kinds.js';
import { projectsKeys } from '../api/projects-list.js';
import { tasksKeys } from '../api/tasks-keys.js';
import type { KeyBatcher } from './invalidation-batcher.js';

/** Каталожные события «Полей» и справочников (#431, ADR-0029): рассылаются
 *  всем — инвалидируются определения полей, справочники и блок «Атрибуты»
 *  карточек (детали задач и строки списков несут значения). */
const CATALOG_EVENTS = new Set<string>([
  ...CUSTOM_FIELD_CATALOG_EVENTS,
  ...DICTIONARY_CATALOG_EVENTS,
]);

/** Ключи кэша по событию `custom_field.*` / `dictionary.*`. true — событие
 *  обработано здесь, false — не наше (роутер пробует дальше). */
export function pushCustomFieldKeys(
  batcher: KeyBatcher,
  queryClient: QueryClient,
  type: string,
): boolean {
  if (!CATALOG_EVENTS.has(type)) return false;
  batcher.push(customFieldsKeys.all, 'list');
  batcher.push(dictionariesKeys.all, 'list');
  // Удаление атрибута чистит слоты форм типов проектов и видов папок
  // (#646): каталоги перечитываются, иначе форма покажет удалённый слот.
  batcher.push(projectsKeys.types(), 'list');
  batcher.push(nodeKindsKeys.all, 'list');
  // Новое поле/вариант меняет карточку и строки списков (значения и подписи).
  batcher.push(tasksKeys.detailsAll(), 'list');
  batcher.push(tasksKeys.listPages(), 'list');
  return true;
}
