import type { QueryClient } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';
import {
  CUSTOM_FIELD_CATALOG_EVENTS,
  CUSTOM_FIELD_EVENTS,
  DICTIONARY_CATALOG_EVENTS,
} from '@nodus/contracts';

import { lettersKeys } from '../api/letters-keys.js';
import { customFieldsKeys } from '../custom-fields/queries.js';
import { dictionariesKeys } from '../dictionaries/keys.js';
import { nodeKindsKeys } from '../api/node-kinds.js';
import { projectsKeys } from '../api/projects-list.js';
import { tasksKeys } from '../api/tasks-keys.js';
import { stageIdOfColumnKey } from '../lib/board/kanban-column-key.js';
import type { KeyBatcher } from './invalidation-batcher.js';

/** Каталожные события «Полей» и справочников (#431, ADR-0029): рассылаются
 *  всем — инвалидируются определения полей, справочники и блок «Атрибуты»
 *  карточек (детали задач и строки списков несут значения). */
const CATALOG_EVENTS = new Set<string>([
  ...CUSTOM_FIELD_CATALOG_EVENTS,
  ...DICTIONARY_CATALOG_EVENTS,
]);

/**
 * Ключи кэша по событию `custom_field.*` / `dictionary.*`. true — событие
 * обработано здесь, false — не наше (роутер пробует дальше).
 *
 * `custom_field.formula_changed` (#632, O4) — АДРЕСНОЕ событие с аудиторией
 * хоста (приходит только тем, кто запись видит): перечитываем деталь и списки
 * хоста, чтобы значок fx и бейдж ошибки приехали с DTO. Значений в payload
 * нет — только `hostKind`/`hostId`/`fieldId`/`hasError`.
 */
export function pushCustomFieldKeys(
  batcher: KeyBatcher,
  queryClient: QueryClient,
  type: string,
  payload: Record<string, unknown> = {},
): boolean {
  if (type === CUSTOM_FIELD_EVENTS.FORMULA_CHANGED) {
    pushFormulaChangedKeys(batcher, queryClient, payload);
    return true;
  }
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

/**
 * Колонки досок, в кэше которых лежит карточка задачи. Бейдж ошибки формулы
 * живёт в `TaskListItem.customFieldFormulas`, а событие адресное и стадии не
 * меняет — перезапрашиваются только колонки с этой карточкой (таргетинг тот
 * же, что у `pushKanbanKeys` в task-invalidation; продублирован осознанно:
 * каталог событий задачи его не знает, а правится он другим пакетом — A6-2).
 * Не нашлась в первых страницах — карточка может быть в догруженной странице
 * колонки с продолжением: такие колонки тоже перезапрашиваются.
 */
function pushKanbanColumnsOf(batcher: KeyBatcher, queryClient: QueryClient, taskId: string): void {
  const columns = queryClient
    .getQueryCache()
    .findAll({ queryKey: tasksKeys.kanbanAll() })
    .filter((query) => stageIdOfColumnKey(query.queryKey) !== null);
  const pageOf = (query: (typeof columns)[number]) =>
    query.state.data as Paginated<TaskListItem> | undefined;
  const holds = (query: (typeof columns)[number]) =>
    pageOf(query)?.items.some((task) => task.id === taskId) ?? false;
  const onBoard = columns.some(holds);
  for (const query of columns) {
    const mayHide = !onBoard && Boolean(pageOf(query)?.nextCursor);
    if (holds(query) || mayHide) batcher.push(query.queryKey, 'list');
  }
}

/**
 * Инвалидации по `custom_field.formula_changed` (#632): формула ячейки
 * поставлена/снята или сменилось её состояние ошибки — значения не меняются,
 * но DTO несёт `customFieldFormulas` (fx/«!»), поэтому деталь хоста и списки,
 * где он виден, перечитываются.
 *
 * Папка живёт в дереве проекта, а `projectId` в событии нет (payload без
 * значений и адресов чужих записей) — перечитываем деревья префиксом.
 */
function pushFormulaChangedKeys(
  batcher: KeyBatcher,
  queryClient: QueryClient,
  payload: Record<string, unknown>,
): void {
  const hostId = typeof payload.hostId === 'string' ? payload.hostId : null;
  if (!hostId) return;
  switch (payload.hostKind) {
    case 'task':
      // Деталь перечитываем ВСЕГДА, включая автора правки: пересчёт
      // зависимых формул идёт обработчиком события уже ПОСЛЕ ответа PATCH,
      // поэтому ответ мутации содержит старые значения. Гейт «свежая
      // мутация» здесь давал регрессию «формула обновляется только после
      // перезагрузки страницы» — лишний GET дешевле сломанного UX.
      batcher.push(tasksKeys.detail(hostId), 'list');
      batcher.push(tasksKeys.listPages(), 'list');
      pushKanbanColumnsOf(batcher, queryClient, hostId);
      return;
    case 'letter':
      batcher.push(lettersKeys.detail(hostId), 'list');
      batcher.push(lettersKeys.lists(), 'list');
      return;
    case 'project':
      batcher.push(projectsKeys.detail(hostId), 'list');
      batcher.push(projectsKeys.journals(), 'list');
      return;
    case 'node':
      batcher.push(projectsKeys.structures(), 'list');
      return;
    default:
      // Неизвестный вид хоста — событие наше, но перечитывать нечего.
      return;
  }
}
