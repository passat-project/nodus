import type { InjectionToken } from '@nestjs/common';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
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
 * Место сущности — критерий скопинга реестра (Р3 #631): тип процесса
 * (задачи/письма), тип проекта или вид папки. Реестр отдаёт только
 * атрибуты, привязанные к этому месту («Где используется»); XOR с пустым —
 * весь реестр (старые вызовы). Отдельной ветки `fieldIds` больше нет:
 * привязка вида папки — та же строка `field_bindings`.
 */
export interface RegistryTarget {
  kind: 'process_type' | 'project_type' | 'node_kind';
  id: string;
}

export interface RegistryScoping {
  target?: RegistryTarget;
}

export interface PrepareCreateArgs extends RegistryScoping {
  /** Значения, пришедшие от клиента (могут быть неполными). */
  input: CustomFieldValues;
  /** Автор сущности — источник умолчания «подразделение автора» (Р5). */
  authorId: string;
  /** Актёр запроса (#52, Р5 #631): значения-ссылки на записи проверяются
   *  на видимость актёру (скрытая цель = несуществующая). */
  actor: ProjectActor;
}

export interface PrepareUpdateArgs extends RegistryScoping {
  /** Текущие значения сущности (JSONB как есть). */
  current: CustomFieldValues;
  /** Патч: `null` удаляет ключ; непустые — проверяются. */
  patch: Record<string, CustomFieldValue | null>;
  /** Актёр запроса (#52, Р5 #631): проверка видимости значений-ссылок. */
  actor: ProjectActor;
}

/** Что читать из реестра: без `target` — весь реестр (карточки, фильтры). */
export type RegistryQuery = RegistryScoping;

export interface CustomFieldRegistry {
  /** Определения (весь реестр или место сущности). Порядок — карточки. */
  definitions(opts?: RegistryQuery, tx?: TransactionClient): Promise<CustomFieldDefinition[]>;

  /** Создание сущности: умолчания (невалидные пропускаются) + ввод
   *  (явное значение важнее) + проверка. Ошибка — 422 со списком полей. */
  prepareCreate(args: PrepareCreateArgs, tx?: TransactionClient): Promise<CustomFieldValues>;

  /** Правка: `null` удаляет ключ, проверяются ТОЛЬКО изменённые значения. */
  prepareUpdate(
    args: PrepareUpdateArgs,
    tx?: TransactionClient,
  ): Promise<{ next: CustomFieldValues; changes: RegistryFieldChange[] }>;

  /** Ссылки для показа значений детали (Р6): имена, аватары, архивность.
   *  actor (#52, Р5 #631): невидимые цели — name null. */
  refs(
    values: CustomFieldValues,
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]>;

  /** Ссылки пачкой по списку карт значений (#556, Р4): срез структуры
   *  проекта отдаёт значения всех папок одним набором ссылок (О2) — одна
   *  пачка запросов на вид ссылки вместо N+1 по папкам. Дедуп `kind:id`. */
  refsMany(
    valuesList: readonly CustomFieldValues[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]>;

  /** Слот формы места — привязка (Р3/Р10 #631): запись формы вида/типа
   *  синхронизирует привязки атрибутов этого места с набором слотов
   *  (слот добавлен — привязка появляется, убран — снимается; значения
   *  не трогаются). project_type | node_kind — у типов процессов форм-слотов
   *  нет (окно создания живёт в маршруте). */
  syncPlaceBindings(
    target: RegistryTarget,
    fieldIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<void>;
}
