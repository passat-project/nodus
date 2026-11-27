/* eslint-disable nodus-internal/max-lines-warn -- задачи как источник формул и полной выборки (#632/#635): один селект и оба семейства методов чтения живут вместе */
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
import { CONDITION_LIMITS } from '@nodus/contracts';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import { visibleTasksWhere, ViewerResolver } from '../access/task-visibility.js';
import {
  capSelection,
  type ConditionRecordData,
  type ConditionSelection,
} from '../../custom-fields/ports/condition-records.port.js';
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

  async conditionTasks(
    query: Parameters<TaskFormulaValues['conditionTasks']>[0],
    tx?: TransactionClient,
  ): Promise<ConditionSelection> {
    const db = tx ?? this.prisma;
    // Полная выборка (#635): конфиденциальные и невидимые входят — квантор
    // «все выполнены» не должен врать; причина фильтрует видимость отдельно.
    // Мягко удалённые исключены всегда. Потолок CONDITION_LIMITS.selection:
    // take +1 различает «ровно потолок» и «больше», сверх не возвращается.
    const take = CONDITION_LIMITS.selection + 1;
    let rows: TaskRow[];
    switch (query.kind) {
      case 'one':
        rows = await db.task.findMany({
          where: { id: query.id, deletedAt: null },
          select: taskSelect,
        });
        break;
      case 'subtasks_of':
        rows = await db.task.findMany({
          where: { parentId: query.taskId, deletedAt: null },
          select: taskSelect,
          orderBy: [{ number: 'asc' }],
          take,
        });
        break;
      case 'related_of': {
        const links = await db.taskRelation.findMany({
          where: {
            kind: query.relation,
            ...(query.direction === 'out'
              ? { fromTaskId: query.taskId }
              : query.direction === 'in'
                ? { toTaskId: query.taskId }
                : { OR: [{ fromTaskId: query.taskId }, { toTaskId: query.taskId }] }),
          },
          select: { fromTaskId: true, toTaskId: true },
          // Порядок делает обрез take детерминированным: без него состав
          // первых связей недетерминирован (security-ревью #635).
          orderBy: [{ fromTaskId: 'asc' }, { toTaskId: 'asc' }],
          take,
        });
        const ids = [
          ...new Set(
            links.map((link) =>
              link.fromTaskId === query.taskId ? link.toTaskId : link.fromTaskId,
            ),
          ),
        ];
        // Переполнение СВЯЗЕЙ — та же неполная выборка: живая задача-нарушитель
        // может лежать за пределами take, квантор не должен врать (#635).
        const linked =
          ids.length === 0
            ? []
            : await db.task.findMany({
                where: { id: { in: ids }, deletedAt: null },
                select: taskSelect,
                orderBy: [{ number: 'asc' }],
                take,
              });
        const capped = capSelection(linked.map((row) => toConditionRecord(row)));
        return {
          records: capped.records,
          overflowed: capped.overflowed || links.length > CONDITION_LIMITS.selection,
        };
      }
      case 'node_tasks':
        // Папка без проекта (аномалия данных) выборки не имеет — A7-2.
        if (query.projectId === null) return capSelection([]);
        rows = await db.task.findMany({
          where: { nodeId: query.nodeId, projectId: query.projectId, deletedAt: null },
          select: taskSelect,
          orderBy: [{ number: 'asc' }],
          take,
        });
        break;
      case 'nodes_tasks':
        // Задачи нескольких папок одним запросом (#635, folder_type_tasks):
        // общий потолок на всё множество, N+1 по папкам не появляется.
        if (query.projectId === null || query.nodeIds.length === 0) return capSelection([]);
        rows = await db.task.findMany({
          where: {
            nodeId: { in: [...query.nodeIds] },
            projectId: query.projectId,
            deletedAt: null,
          },
          select: taskSelect,
          orderBy: [{ number: 'asc' }],
          take,
        });
        break;
      case 'project_tasks':
        rows = await db.task.findMany({
          where: { projectId: query.projectId, deletedAt: null },
          select: taskSelect,
          orderBy: [{ number: 'asc' }],
          take,
        });
        break;
      case 'ids':
        rows =
          query.ids.length === 0
            ? []
            : await db.task.findMany({
                where: { id: { in: [...query.ids] }, deletedAt: null },
                select: taskSelect,
                orderBy: [{ number: 'asc' }],
                take,
              });
        break;
    }
    return capSelection(rows.map((row) => toConditionRecord(row)));
  }

  async visibleTaskIds(
    ids: readonly string[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const viewer = await this.viewers.resolve(actor);
    const rows = await (tx ?? this.prisma).task.findMany({
      where: { id: { in: [...ids] }, deletedAt: null, AND: visibleTasksWhere(viewer, 'all') },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
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

/** Строка задачи → запись общей выборки #635 (предикаты и причины). */
function toConditionRecord(row: TaskRow): ConditionRecordData {
  return {
    kind: 'task',
    id: row.id,
    name: row.title,
    typeId: row.typeId,
    stageId: row.stageId,
    values: (row.customFields ?? {}) as CustomFieldValues,
    projectId: row.projectId,
    parentId: row.parentId,
    nodeId: row.nodeId,
  };
}
