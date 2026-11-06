import type { InjectionToken } from '@nestjs/common';
import type {
  CustomFieldValues,
  FormulaHostKind,
  FormulaRelationDirection,
  FormulaRelationKind,
} from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';

/**
 * Порт чтения записей-источников формул (#632, Р7/Р11). Реализуют модули-
 * владельцы данных (tasks, projects, correspondence); custom-fields собирает
 * из него резолвер движка. Фильтрация видимости (Р7) — здесь, там где живут
 * данные: движок не умеет читать мимо порта.
 *
 * Один источник — одна запись; выборки агрегатов — списки. `actor` в
 * `record` — проверка видимости для пользовательских путей (evaluate):
 * невидимый хост = null (404 без оракула). Пересчёт (системный путь) зовёт
 * без актора.
 *
 * Тот же актор нужен и выборкам агрегатов (A7-1): у безпроектной (личной)
 * записи «своё дерево» не определено, поэтому связанные записи фильтруются
 * зоной видимости актора, а без актора выборка пуста — иначе в агрегат
 * личной задачи попадали бы ЛЮБЫЕ не-конфиденциальные задачи портала.
 */
export const RECORD_VALUES_READER: InjectionToken = 'RECORD_VALUES_READER';

/** Запись-источник значений формулы: значения атрибутов + системные поля +
 *  контекст места (проект, родитель, папка, тип/вид). */
export interface FormulaRecordData {
  kind: FormulaHostKind;
  id: string;
  /** Значения атрибутов (JSONB как есть) — конвертация в язык формул в резолвере. */
  values: CustomFieldValues;
  /** Системные поля (`FORMULA_SYSTEM_FIELDS`), уже в типах языка. */
  system: Record<string, FormulaValue | undefined>;
  /** Проект записи (task/letter/node) — фильтр Р7 «своё дерево». */
  projectId: string | null;
  /** Родитель: задача (task) или папка (node). */
  parentId: string | null;
  /** Узел структуры задачи (task) — источник «папка». */
  nodeId: string | null;
  /** Место записи: тип процесса (task/letter), тип проекта, вид папки. */
  placeId: string | null;
  /** Конфиденциальность (task/letter): в выборки агрегатов не попадает (В1). */
  confidential: boolean;
}

export interface RecordReadOptions {
  /** Актёр пользовательского пути: невидимая запись = null (Р7), а выборки
   *  безпроектных записей — только его зона видимости (A7-1). */
  actor?: ProjectActor;
}

export interface RecordValuesReader {
  /** Запись по виду и id; null — нет или не видна актору. */
  record(
    kind: FormulaHostKind,
    id: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null>;

  /** Подзадачи задачи (Р2 `related{subtasks}`), отфильтрованные Р7. */
  subtasks(
    taskId: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]>;

  /** Связанные задачи (Р2 `related{relations}`) с учётом направления. */
  relatedTasks(
    taskId: string,
    relation: FormulaRelationKind,
    direction: FormulaRelationDirection,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]>;

  /** Задачи папки (Р2 `related{node_tasks}`), отфильтрованные Р7. `projectId`
   *  — проект папки: задачи выборки обязаны принадлежать ему (A7-2), папка
   *  без проекта (аномалия данных) выборки не имеет. */
  nodeTasks(
    nodeId: string,
    projectId: string | null,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]>;

  /** Срез папок проекта (цепочки предков и агрегаты по цепочке, Р6). */
  projectNodes(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData[]>;
}
