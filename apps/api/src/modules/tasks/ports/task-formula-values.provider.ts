import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomFieldValues,
  FormulaRelationDirection,
  FormulaRelationKind,
} from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import { visibleTasksWhere, ViewerResolver } from '../access/task-visibility.js';
import type {
  FormulaRecordData,
  RecordReadOptions,
} from '../../custom-fields/ports/record-values.port.js';
import type { TaskFormulaValues } from './task-formula-values.port.js';

/** Выборка записи-источника формулы (#632, Р7): значения + системные поля. */
const taskSelect = {
  id: true,
  number: true,
  title: true,
  deadline: true,
  createdAt: true,
  stageId: true,
  assigneeId: true,
  creatorId: true,
  parentId: true,
  projectId: true,
  nodeId: true,
  typeId: true,
  confidential: true,
  deletedAt: true,
  customFields: true,
} as const;

/**
 * Задачи как источник формул (#632, Р7/Р11): значения атрибутов, системные
 * поля и выборки связанных. Видимость — та же функция, что у списка задач
 * (`visibleTasksWhere`): чужие секретные проекты и конфиденциальные задачи
 * не попадают ни в один источник (вердикт В1 — исключены для всех).
 * У личной (безпроектной) записи «своё дерево» не определено — выборки
 * связанных сужаются до зоны видимости актора, а без актора пусты (A7-1);
 * задачи папки всегда фильтруются проектом папки (A7-2).
 */
@Injectable()
export class TaskFormulaValuesProvider implements TaskFormulaValues {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewers: ViewerResolver,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  async record(
    id: string,
    opts: RecordReadOptions = {},
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null> {
    const db = tx ?? this.prisma;
    if (opts.actor) {
      const viewer = await this.viewers.resolve(opts.actor);
      const row = await db.task.findFirst({
        where: { AND: [{ id }, visibleTasksWhere(viewer, 'all')] },
        select: taskSelect,
      });
      return row ? this.toRecord(row) : null;
    }
    // Без актора (источник формулы у пересчёта) мягко удалённая задача
    // источником не бывает: «смерть связей» (Р7) — как и в ветке видимости.
    const row = await db.task.findFirst({ where: { id, deletedAt: null }, select: taskSelect });
    return row ? this.toRecord(row) : null;
  }

  async subtasks(
    taskId: string,
    opts: RecordReadOptions = {},
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    const db = tx ?? this.prisma;
    // Р7 (д): только свой проект — подзадача/связь из чужого (в т.ч.
    // секретного) проекта не попадает в агрегаты.
    const host = await db.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    // Нет хоста — нет выборки. Без проекта фильтр `projectId: null`: иначе
    // подзадача из чужого (в т.ч. секретного) проекта попала бы в агрегат.
    if (!host) return [];
    // A7-1: у личной задачи «своё дерево» — зона видимости актора, без
    // актора (фоновый пересчёт) выборки нет (см. selectionScope).
    const scope = await this.selectionScope(host.projectId, opts.actor);
    if (!scope) return [];
    const rows = await db.task.findMany({
      where: {
        parentId: taskId,
        deletedAt: null,
        confidential: false,
        projectId: host.projectId,
        ...scope,
      },
      select: taskSelect,
      orderBy: [{ number: 'asc' }],
      take: FORMULA_LIMITS.selection + 1,
    });
    return this.toRecords(rows);
  }

  async relatedTasks(
    taskId: string,
    relation: FormulaRelationKind,
    direction: FormulaRelationDirection,
    opts: RecordReadOptions = {},
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    const db = tx ?? this.prisma;
    const links = await db.taskRelation.findMany({
      where: {
        kind: relation,
        ...(direction === 'out'
          ? { fromTaskId: taskId }
          : direction === 'in'
            ? { toTaskId: taskId }
            : { OR: [{ fromTaskId: taskId }, { toTaskId: taskId }] }),
      },
      select: { fromTaskId: true, toTaskId: true },
      take: FORMULA_LIMITS.selection + 1,
    });
    const ids = [
      ...new Set(
        links.map((link) => (link.fromTaskId === taskId ? link.toTaskId : link.fromTaskId)),
      ),
    ];
    if (ids.length === 0) return [];
    const host = await db.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    // Связи удалённой/несуществующей записи источником не бывают.
    if (!host) return [];
    const scope = await this.selectionScope(host.projectId, opts.actor);
    if (!scope) return [];
    const rows = await db.task.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        confidential: false,
        // «Своё дерево» (Р7): безпроектная задача не тянет связанные из
        // чужих проектов (иначе личная задача — канал чтения секретных).
        projectId: host.projectId,
        ...scope,
      },
      select: taskSelect,
      take: FORMULA_LIMITS.selection + 1,
    });
    return this.toRecords(rows);
  }

  async nodeTasks(
    nodeId: string,
    projectId: string | null,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    // A7-2: задачи папки — только своего проекта, симметрично подзадачам и
    // связям. Без фильтра задача с `nodeId` узла проекта A, но `projectId`
    // проекта B попадала бы в агрегат папки A. Папка без проекта (аномалия
    // данных) выборки не имеет.
    if (projectId === null) return [];
    const rows = await (tx ?? this.prisma).task.findMany({
      where: { nodeId, projectId, deletedAt: null, confidential: false },
      select: taskSelect,
      orderBy: [{ number: 'asc' }],
      take: FORMULA_LIMITS.selection + 1,
    });
    return this.toRecords(rows);
  }

  /**
   * Область выборки связанных записей (A7-1). Свой проект — фильтр
   * `projectId` (его и так задаёт вызывающая выборка); безпроектная (личная)
   * запись — зона видимости актора той же функцией, что у списка задач
   * (участие, надзор, решающий, `task.view_all`). Без актора (фоновый
   * пересчёт, формула типа) безпроектный хост выборок не имеет: агрегат
   * личной задачи не должен собирать все личные задачи портала. `null` —
   * выборки нет.
   */
  private async selectionScope(
    projectId: string | null,
    actor: ProjectActor | undefined,
  ): Promise<Prisma.TaskWhereInput | null> {
    if (projectId !== null) return {};
    if (!actor) return null;
    return visibleTasksWhere(await this.viewers.resolve(actor), 'all');
  }

  /** Системные поля задачи в типах языка (FORMULA_SYSTEM_FIELDS). */
  private async toRecords(rows: readonly TaskRow[]): Promise<FormulaRecordData[]> {
    if (rows.length === 0) return [];
    const stages = await this.catalog.stagesByIds([...new Set(rows.map((row) => row.stageId))]);
    const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
    return rows.map((row) => this.build(row, stageNames.get(row.stageId) ?? null));
  }

  private async toRecord(row: TaskRow): Promise<FormulaRecordData> {
    const stages = await this.catalog.stagesByIds([row.stageId]);
    return this.build(row, stages[0]?.name ?? null);
  }

  private build(row: TaskRow, stageName: string | null): FormulaRecordData {
    const system: Record<string, FormulaValue | undefined> = {
      title: row.title,
      number: row.number,
      deadline: row.deadline?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      stage: stageName,
      assignee: row.assigneeId,
      creator: row.creatorId,
    };
    return {
      kind: 'task',
      id: row.id,
      values: (row.customFields ?? {}) as CustomFieldValues,
      system,
      projectId: row.projectId,
      parentId: row.parentId,
      nodeId: row.nodeId,
      placeId: row.typeId,
      confidential: row.confidential,
    };
  }
}

type TaskRow = {
  id: string;
  number: number;
  title: string;
  deadline: Date | null;
  createdAt: Date;
  stageId: string;
  assigneeId: string;
  creatorId: string;
  parentId: string | null;
  projectId: string | null;
  nodeId: string | null;
  typeId: string;
  confidential: boolean;
  deletedAt: Date | null;
  customFields: unknown;
};
