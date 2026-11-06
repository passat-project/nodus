import type { InjectionToken } from '@nestjs/common';

/**
 * Порт использования атрибутов в проектах (#556 Р11; ревизия #631): окно
 * последствий удаления спрашивает, сколько значений живёт в проектах и
 * папках (привязки и формы видов реестр атрибутов читает из своих таблиц).
 * Потребитель — модуль custom-fields (`usage`), владелец данных — projects
 * (I3): чужие таблицы читаются только через порт, не запросом.
 */
export const PROJECT_FIELD_USAGE_READER: InjectionToken = 'PROJECT_FIELD_USAGE_READER';

/** Где живут значения: проекты и папки структуры. */
export type ProjectFieldScope = 'project' | 'node';

export interface ProjectFieldUsageReader {
  /** Сущностей области со значением атрибута (значение — любой непустой
   *  ключ JSONB; `null` в JSONB не хранится — очистка удаляет ключ). */
  countValues(scope: ProjectFieldScope, fieldId: string): Promise<number>;
}
