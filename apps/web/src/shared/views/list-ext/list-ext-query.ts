import type {
  ConditionPredicate,
  ListEntity,
  ListGroup,
  ListSort,
  ListSystemField,
  ListTotal,
} from '@nodus/contracts';
import { LIST_SYSTEM_FIELDS_BY_ENTITY } from '@nodus/contracts';

/**
 * Транспорт расширения списка (#435): ext-параметры в query (честный JSON,
 * как у сервера — `?filter=%5B…%5D&sort=…`), карта «колонка реестра → поле
 * списка» и сырые значения полей строк для группировки (ключ группы — то же
 * выражение, что на сервере: uuid-ссылки, ISO-даты, числа).
 */

/** Запрос с расширением: любое из полей заполнено — список идёт ext-конвейером
 *  (сервер: hasListExt). Пустые массивы тоже значимы (прошли сброс). */
export interface ListExtParams {
  filter: ConditionPredicate[];
  sort: ListSort[];
  group?: ListGroup;
  totals: ListTotal[];
}

export function hasListExtParams(ext: ListExtParams): boolean {
  return (
    ext.filter.length > 0 || ext.sort.length > 0 || ext.group !== undefined || ext.totals.length > 0
  );
}

/** Добавить ext-параметры в URLSearchParams (никогда не пустые значения —
 *  присутствие параметра переключает конвейер сервера). */
export function applyExtParams(params: URLSearchParams, ext: ListExtParams): URLSearchParams {
  if (ext.filter.length > 0) params.set('filter', JSON.stringify(ext.filter));
  if (ext.sort.length > 0) params.set('sort', JSON.stringify(ext.sort));
  if (ext.group) params.set('group', JSON.stringify(ext.group));
  if (ext.totals.length > 0) params.set('totals', JSON.stringify(ext.totals));
  return params;
}

/** Серверное поле списка из id колонки реестра: системные поля журнала
 *  называются как в контракте (совпадение id — прямое), атрибуты cf.<uuid>
 *  проходят насквозь; null — колонка сервером не сортируется/не группируется
 *  (численные агрегаты UI, «Постановщик», «Обновлено» — клиентские оси). */
export function listFieldOfColumn(entityId: string, entity: ListEntity): string | null {
  if (entityId.startsWith('cf.')) return entityId;
  const allowed = LIST_SYSTEM_FIELDS_BY_ENTITY[entity] as readonly string[];
  return allowed.includes(entityId) ? entityId : null;
}

/** Сырое значение поля строки — то же выражение, по которому сервер считает
 *  ключ группы: uuid ссылок, ISO-моменты, число — числом, пусто — null.
 *  Задачи и письма несут всюду ref'ы в DTO; createdAt задач/писем в DTO нет —
 *  поле не группируется (см. groupableFields). */
export type ListRowValueExtractor<T> = (row: T, field: string) => string | number | null;

/** Системные поля сущности, доступные И клиенту (значение есть в DTO) — для
 *  выбора поля группировки; сортировка доступна всем полям сущности. */
export const GROUPABLE_SYSTEM_FIELDS: Record<ListEntity, readonly ListSystemField[]> = {
  task: [
    'number',
    'title',
    'stage',
    'deadline',
    'assignee',
    'type',
    'project',
    'folder',
    'decidedBy',
    'decidedAt',
  ],
  letter: ['regNumber', 'correspondent', 'sentAt', 'assignee', 'type', 'project', 'stage'],
  folder: ['name', 'kind', 'createdAt'],
};
