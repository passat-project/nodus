import type { InjectionToken } from '@nestjs/common';
import type { AuthUser, ListEntity, ListFilter, ListSort, ListViewScope } from '@nodus/contracts';

/**
 * Порт источника строк выгрузки CSV (#435): модуль-владелец сущности
 * (tasks/correspondence/projects) отдаёт строки «как на экране» — та же
 * видимость, рамка scope, фильтр и сортировка, что у ext-списка. Колонки
 * (системные поля и атрибуты) провайдер уже разрешает в показательные
 * значения: имена ссылок, даты ISO, числа; views-модуль только печатает CSV.
 */
export const LIST_EXPORT_SOURCE: InjectionToken = 'LIST_EXPORT_SOURCE';

/** Токены источников по сущностям: модуль-владелец регистрирует свой
 * провайдер в *-ports.module.ts; views-модуль собирает их в один массив
 * LIST_EXPORT_SOURCE (фабрикой — Nest не мержит один токен из нескольких
 * модулей). */
export const TASK_LIST_EXPORT_SOURCE: InjectionToken = 'TASK_LIST_EXPORT_SOURCE';
export const LETTER_LIST_EXPORT_SOURCE: InjectionToken = 'LETTER_LIST_EXPORT_SOURCE';
export const FOLDER_LIST_EXPORT_SOURCE: InjectionToken = 'FOLDER_LIST_EXPORT_SOURCE';

export interface ListExportQuery {
  entity: ListEntity;
  scope: ListViewScope;
  filter: ListFilter;
  sort: ListSort[];
}

/** Строка выгрузки: значения колонок по ключу поля (системный ключ или
 * `cf.<uuid>`); null — пустая ячейка. */
export interface ListExportRow {
  id: string;
  values: Record<string, string | number | null>;
}

export interface ListExportSource {
  supports(entity: ListEntity): boolean;

  /** Число строк той же выборкой (выбор синхронной/фоновой выгрузки). */
  count(actor: AuthUser, query: ListExportQuery): Promise<number>;

  /** Строки порциями (курсор внутри): порядок — сортировка выгрузки. */
  rows(
    actor: AuthUser,
    query: ListExportQuery,
    chunk?: number,
  ): AsyncGenerator<ListExportRow, void, void>;
}
