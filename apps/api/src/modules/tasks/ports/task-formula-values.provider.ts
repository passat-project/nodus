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
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
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
    const row = await db.task.findUnique({ where: { id }, select: taskSelect });
    return row ? this.toRecord(row) : null;
  }

  async subtasks(taskId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    // Р7 (д): только свой проект — подзадача/связь из чужого (в т.ч.
    // секретного) проекта не попадает в агрегаты.
    const host = await (tx ?? this.prisma).task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    const rows = await (tx ?? this.prisma).task.findMany({
      where: {
        parentId: taskId,
        deletedAt: null,
        confidential: false,
        ...(host?.projectId ? { projectId: host.projectId } : {}),
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
    const rows = await db.task.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        confidential: false,
        ...(host?.projectId ? { projectId: host.projectId } : {}),
      },
      select: taskSelect,
      take: FORMULA_LIMITS.selection + 1,
    });
    return this.toRecords(rows);
  }

  async nodeTasks(nodeId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    const rows = await (tx ?? this.prisma).task.findMany({
      where: { nodeId, deletedAt: null, confidential: false },
      select: taskSelect,
      orderBy: [{ number: 'asc' }],
      take: FORMULA_LIMITS.selection + 1,
    });
    return this.toRecords(rows);
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
