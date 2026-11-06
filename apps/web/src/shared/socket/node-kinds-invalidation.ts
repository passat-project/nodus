import type { QueryClient } from '@tanstack/react-query';
import { PROJECT_CATALOG_EVENTS, PROJECT_EVENTS } from '@nodus/contracts';

import { customFieldsKeys } from '../custom-fields/queries.js';
import { nodeKindsKeys } from '../api/node-kinds.js';
import { projectsKeys } from '../api/projects-list.js';
import type { KeyBatcher } from './invalidation-batcher.js';

/** Каталожные события видов папок (#556, Р10): форма и возможности вида
 *  изменились — реестр видов и `kinds` в кэшах структур перечитываются без
 *  F5. Узлы по-прежнему без реалтайма (ADR-0030), но каталог вида — данные
 *  без персональных данных, рассылается всем (О6). */
const KIND_EVENTS = new Set<string>([...PROJECT_CATALOG_EVENTS]);

/** Ключи кэша по событию `project.node_kind_changed`. true — событие
 *  обработано здесь, false — не наше (роутер пробует дальше). */
export function pushNodeKindKeys(
  batcher: KeyBatcher,
  queryClient: QueryClient,
  type: string,
): boolean {
  if (!KIND_EVENTS.has(type)) return false;
  batcher.push(nodeKindsKeys.all, 'list');
  batcher.push(projectsKeys.structures(), 'list');
  // Форма места синхронизирует привязки (#646): «Где используется» в
  // реестре атрибутов и фильтр модуля перечитываются.
  batcher.push(customFieldsKeys.all, 'list');
  if (type === PROJECT_EVENTS.TYPE_CHANGED) {
    batcher.push(projectsKeys.types(), 'list');
  }
  return true;
}
