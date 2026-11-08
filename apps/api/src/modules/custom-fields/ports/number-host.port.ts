import type { InjectionToken } from '@nestjs/common';
import type { NumberContainerHit, NumberContainerRef, NumberHostKind } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Записи-носители счётчиков (#630, модель v3): модуль атрибутов не читает
 * таблицы задач, папок, проектов и писем (I3/I6). Модуль-владелец
 * регистрирует провайдер по статическому маркеру `numberHostKinds`
 * (DiscoveryService — тот же приём, что адаптеры маршрутов): он знает, где
 * лежит запись, какие у неё значения и как записать выданный номер.
 */
export const NUMBER_HOST_REGISTRY: InjectionToken = 'NUMBER_HOST_REGISTRY';

/** Кто смотрит (id + права) — видимость записей и секретных проектов. */
export interface NumberActor {
  id: string;
  permissions: readonly string[];
}

/** Значения источников поля-вставки номера: сама запись, её проект,
 *  родительская задача, папки снаружи от ближайшей. */
export interface NumberTargetSources {
  self: Readonly<Record<string, unknown>>;
  project?: Readonly<Record<string, unknown>> | null;
  parentTask?: Readonly<Record<string, unknown>> | null;
  /** Папки СНАРУЖИ записи от ближайшей вверх — со значениями атрибутов. */
  folders?: readonly { kindId: string; values: Readonly<Record<string, unknown>> }[];
}

/** Место записи, которое провайдер отдаёт движку: дерево, проект, тип,
 *  родитель и значения источников (fieldNumber → id разрешает движок). */
export interface NumberTarget {
  host: NumberHostKind;
  /** Свой тип записи: тип задачи/письма, вид папки, тип проекта. */
  typeId: string | null;
  /** Папки СНАРУЖИ записи от ближайшей вверх. */
  folders: readonly { id: string; kindId: string }[];
  projectId: string | null;
  portfolioId: string | null;
  projectTypeId: string | null;
  parentTaskId: string | null;
  sources: NumberTargetSources;
}

/** Существующая запись, которая может получать номер. */
export interface NumberHostRecord {
  kind: NumberHostKind;
  id: string;
  name: string;
  typeId: string;
  /** Порядок создания: у задачи — её номер, у папки/проекта — createdAt. */
  order: number;
  /** Видна ли запись смотрящему (секретные проекты, конфиденциальные). */
  visible: boolean;
  target: NumberTarget;
}

export interface NumberHostProvider {
  readonly numberHostKinds: readonly NumberHostKind[];

  /** Записи отмеченных типов — ВИДИМЫЕ и НЕВИДИМЫЕ (у невидимых флаг
   *  `visible: false`: примеры не раскрываются, счёт — числом). */
  listHosts(
    tx: TransactionClient,
    actor: NumberActor,
    typeIds: readonly string[],
  ): Promise<NumberHostRecord[]>;

  /** Одна запись по id; невидимая смотрящему — null (без оракула). */
  findHost(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<NumberHostRecord | null>;

  /** Записать выданный номер в значения записи (системная запись в tx). */
  writeNumber(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    fieldId: string,
    display: string,
  ): Promise<void>;

  /** Имя и путь значения условия («КЖ-01», «ЖК Минск-Мир › Здание 1»);
   *  null — не его запись (registry спросит следующий провайдер). */
  resolveRef(
    tx: TransactionClient,
    hit: NumberContainerHit,
    actor: NumberActor,
  ): Promise<NumberContainerRef | null>;

  /** Сколько записей отмеченных типов ещё без номера этого атрибута. */
  countWithoutNumber(
    tx: TransactionClient,
    typeIds: readonly string[],
    fieldId: string,
  ): Promise<number>;
}

/** Сводный реестр носителей: движок и API счётчиков не знают, сколько
 *  модулей их регистрирует. */
export interface NumberHostRegistry {
  list(
    tx: TransactionClient,
    actor: NumberActor,
    typeIds: readonly string[],
  ): Promise<NumberHostRecord[]>;

  find(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<NumberHostRecord | null>;

  writeNumber(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    fieldId: string,
    display: string,
  ): Promise<void>;

  resolveRef(
    tx: TransactionClient,
    hit: NumberContainerHit,
    actor: NumberActor,
  ): Promise<NumberContainerRef | null>;

  countWithoutNumber(
    tx: TransactionClient,
    typeIds: readonly string[],
    fieldId: string,
  ): Promise<number>;
}
