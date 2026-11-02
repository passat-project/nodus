import type { InjectionToken } from '@nestjs/common';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldScope,
  CustomFieldValue,
  CustomFieldValues,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';

/**
 * Порт реестра кастомных атрибутов для модулей-владельцев сущностей
 * (#431, ADR-0029, Р2). Владелец (tasks, письма, проекты, контрагенты)
 * НЕ читает `field_definitions` и НЕ валидирует значения сам: он зовёт
 * `prepareCreate`/`prepareUpdate` и пишет полученный JSONB в свою колонку.
 * Одна точка динамической валидации (I7) — здесь, а не в каждом модуле.
 *
 * Порядок в `changes` — порядок ключей патча; значения — уже проверенные
 * (тип, активные ссылки).
 */
export const CUSTOM_FIELD_REGISTRY: InjectionToken = 'CUSTOM_FIELD_REGISTRY';

/** Изменение значения для события `task.updated.customFieldChanges` (Р12). */
export interface RegistryFieldChange {
  fieldId: string;
  from: CustomFieldValue | null;
  to: CustomFieldValue | null;
}

/**
 * Скоупинг реестра (#432, #556): тип процесса ИЛИ список атрибутов вида
 * папки. У видов папок нет публикуемого маршрута и таблицы привязок —
 * привязка живёт формой вида (`form.fields`), поэтому реестр фильтруется
 * множеством id. Оба скоупа одновременно — ошибка программиста
 * (`typeId and fieldIds are exclusive`): смешать привязки нельзя.
 */
export interface RegistryScoping {
  /** Тип процесса (#432): только атрибуты, привязанные к типу. */
  typeId?: string;
  /** Вид папки (#556): только атрибуты формы вида (порядок реестра). */
  fieldIds?: readonly string[];
}

export interface PrepareCreateArgs extends RegistryScoping {
  /** Значения, пришедшие от клиента (могут быть неполными). */
  input: CustomFieldValues;
  /** Автор сущности — источник умолчания «подразделение автора» (Р5). */
  authorId: string;
  /** Актёр запроса (#52): значения-ссылки на проекты проверяются на
   *  видимость актёру (секретный проект нельзя поставить значением). */
  actor: ProjectActor;
}

export interface PrepareUpdateArgs extends RegistryScoping {
  /** Текущие значения сущности (JSONB как есть). */
  current: CustomFieldValues;
  /** Патч: `null` удаляет ключ; непустые — проверяются. */
  patch: Record<string, CustomFieldValue | null>;
  /** Актёр запроса (#52): проверка видимости значений-ссылок на проекты. */
  actor: ProjectActor;
}

/** Что читать из реестра: `typeId` — привязанные к типу (#432), `fieldIds` —
 *  атрибуты формы вида папки (#556). */
export type RegistryQuery = RegistryScoping;

export interface CustomFieldRegistry {
  /** Определения области (включая скрытые — служебные значения пишет
   *  автоматика). Порядок — карточки и фильтров. */
  definitions(
    scope: CustomFieldScope,
    opts?: RegistryQuery,
    tx?: TransactionClient,
  ): Promise<CustomFieldDefinition[]>;

  /** Создание сущности: умолчания (невалидные пропускаются) + ввод
   *  (явное значение важнее) + проверка. Ошибка — 422 со списком полей. */
  prepareCreate(
    scope: CustomFieldScope,
    args: PrepareCreateArgs,
    tx?: TransactionClient,
  ): Promise<CustomFieldValues>;

  /** Правка: `null` удаляет ключ, проверяются ТОЛЬКО изменённые значения. */
  prepareUpdate(
    scope: CustomFieldScope,
    args: PrepareUpdateArgs,
    tx?: TransactionClient,
  ): Promise<{ next: CustomFieldValues; changes: RegistryFieldChange[] }>;

  /** Ссылки для показа значений детали (Р6): имена, аватары, архивность.
   *  actor (#52): ссылки-проекты скрываются, если проект не виден актёру. */
  refs(
    scope: CustomFieldScope,
    values: CustomFieldValues,
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]>;

  /** Ссылки пачкой по списку карт значений (#556, Р4): срез структуры
   *  проекта отдаёт значения всех папок одним набором ссылок (О2) — одна
   *  пачка запросов на вид ссылки вместо N+1 по папкам. Дедуп `kind:id`. */
  refsMany(
    scope: CustomFieldScope,
    valuesList: readonly CustomFieldValues[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]>;
}
