import type { InjectionToken } from '@nestjs/common';

/**
 * Порт использования атрибутов в проектах (#556, Р11): окно удаления
 * атрибута показывает, сколько значений живёт в проектах и папках и какие
 * виды папок держат его в форме. Потребитель — модуль custom-fields
 * (`DefinitionsService.usage`), владелец данных — projects (I3): чужие
 * таблицы читаются только через порт, не запросом.
 */
export const PROJECT_FIELD_USAGE_READER: InjectionToken = 'PROJECT_FIELD_USAGE_READER';

/** Области атрибутов, значения которых живут в проектах. */
export type ProjectFieldScope = 'project' | 'node';

export interface ProjectFieldUsageReader {
  /** Сущностей области со значением атрибута (значение — любой непустой
   *  ключ JSONB; `null` в JSONB не хранится — очистка удаляет ключ). */
  countValues(scope: ProjectFieldScope, fieldId: string): Promise<number>;

  /** Виды папок, в форме которых стоит атрибут (архивные тоже). */
  nodeKindsUsing(fieldId: string): Promise<{ id: string; name: string }[]>;
}
