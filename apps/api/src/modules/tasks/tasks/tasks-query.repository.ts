import { Injectable } from '@nestjs/common';
import { statesOfPhase, type ListTasksQuery, type TaskRef } from '@nodus/contracts';

import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import { taskListInclude, type TaskListRow } from './task-row.js';

/** Просрочка — только у фазы open (сданная работа и итог не краснеют,
 *  ADR-0020 дополнение 2). */
const overdueWhere = (now: Date): Prisma.TaskWhereInput => ({
  deadline: { lt: now },
  systemState: { in: statesOfPhase('open') },
});

/** Порядок выдачи списка: колонка глобальной оси, личной оси или номер. */
export type TaskOrder =
  | { kind: 'stage'; after?: { o: string; id: string } }
  | { kind: 'personal'; userId: string; stageId: string; after?: { o: string; id: string } }
  | { kind: 'number'; after?: { n: number } };

/**
 * Чтения задач вне транзакций (CQRS-лайт, пара TasksQueryService): фиды обеих
 * осей, счётчики колонок, деталь, подзадачи, ветка. where видимости приходит
 * из task-visibility — репозиторий его не сочиняет.
 */
@Injectable()
export class TasksQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Фильтры фида поверх видимости (роль смотрящего, колонка, проект,
   *  ответственный, родитель, тип, просрочка, поиск по названию / «ПП-N»). */
  feedFilters(q: ListTasksQuery, me: string, now: Date): Prisma.TaskWhereInput[] {
    const and: Prisma.TaskWhereInput[] = [];
    if (q.role === 'assignee') and.push({ assigneeId: me });
    if (q.role === 'creator') and.push({ creatorId: me });
    if (q.role === 'coexecutor' || q.role === 'observer') {
      and.push({ participants: { some: { userId: me, role: q.role } } });
    }
    if (q.stageId) and.push({ stageId: q.stageId });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.parentId) and.push({ parentId: q.parentId });
    if (q.typeId) and.push({ typeId: q.typeId });
    if (q.overdue) and.push(overdueWhere(now));
    if (q.search) {
      const n = Number(q.search.replace(/^ПП-/i, ''));
      and.push({
        OR: [
          { title: { contains: q.search, mode: 'insensitive' } },
          ...(Number.isSafeInteger(n) && n > 0 ? [{ number: n }] : []),
        ],
      });
    }
    return and;
  }

  async list(
    where: Prisma.TaskWhereInput,
    order: TaskOrder,
    limit: number,
    viewerId: string,
  ): Promise<{ rows: TaskListRow[]; sortKeys: Map<string, string> }> {
    const include = taskListInclude(viewerId);
    if (order.kind === 'personal') {
      const a = order.after;
      const placements = await this.prisma.taskPersonalPlacement.findMany({
        where: {
          userId: order.userId,
          stageId: order.stageId,
          task: where,
          ...(a
            ? { OR: [{ sortOrder: { gt: a.o } }, { sortOrder: a.o, taskId: { gt: a.id } }] }
            : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { taskId: 'asc' }],
        take: limit + 1,
        include: { task: { include } },
      });
      return {
        rows: placements.map((p) => p.task),
        sortKeys: new Map(placements.map((p) => [p.taskId, p.sortOrder])),
      };
    }
    if (order.kind === 'stage') {
      const a = order.after;
      const rows = await this.prisma.task.findMany({
        where: a
          ? {
              AND: [
                where,
                { OR: [{ stageOrder: { gt: a.o } }, { stageOrder: a.o, id: { gt: a.id } }] },
              ],
            }
          : where,
        orderBy: [{ stageOrder: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        include,
      });
      return { rows, sortKeys: new Map(rows.map((r) => [r.id, r.stageOrder])) };
    }
    const rows = await this.prisma.task.findMany({
      where: order.after ? { AND: [where, { number: { lt: order.after.n } }] } : where,
      orderBy: { number: 'desc' },
      take: limit + 1,
      include,
    });
    return { rows, sortKeys: new Map() };
  }

  /** Подзадачи карточки — ПЕРВЫЕ limit по номеру (порядок создания): при
   *  переполнении теряются поздние, а не ранние (ранние — костяк ветки). */
  listSubtasks(
    parentId: string,
    visible: Prisma.TaskWhereInput,
    limit: number,
    viewerId: string,
  ): Promise<TaskListRow[]> {
    return this.prisma.task.findMany({
      where: { AND: [{ parentId }, visible] },
      orderBy: { number: 'asc' },
      take: limit,
      include: taskListInclude(viewerId),
    });
  }

  /** Поля карточки сверх строки списка: описание, чек-лист, происхождение. */
  findDetail(id: string) {
    return this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: { checklist: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
  }

  async parentIdOf(id: string): Promise<string | null> {
    const node = await this.prisma.task.findUnique({ where: { id }, select: { parentId: true } });
    return node?.parentId ?? null;
  }

  /** id поддерева от корня (сам корень + живые потомки). */
  async subtreeIds(rootId: string): Promise<string[]> {
    const nodes = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM tasks WHERE id = ${rootId}::uuid
        UNION SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id WHERE t.deleted_at IS NULL
      ) SELECT id FROM tree`;
    return nodes.map((n) => n.id);
  }

  branchRows(ids: string[]) {
    return this.prisma.task.findMany({
      where: { id: { in: ids } },
      orderBy: { number: 'asc' },
    });
  }

  async visibleIdsAmong(ids: string[], visible: Prisma.TaskWhereInput): Promise<string[]> {
    const rows = await this.prisma.task.findMany({
      where: { AND: [{ id: { in: ids } }, visible] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Состав живой задачи (беседа задачи в чате, read-порт ADR-0012). */
  findLiveRoster(taskId: string) {
    return this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      select: { creatorId: true, assigneeId: true, participants: true },
    });
  }

  /** Номер и название задач по id (ссылки чата). */
  findRefs(taskIds: string[]): Promise<TaskRef[]> {
    return this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, number: true, title: true },
    });
  }

  /** Видна ли задача по where видимости смотрящего. */
  async isVisible(taskId: string, visible: Prisma.TaskWhereInput): Promise<boolean> {
    const row = await this.prisma.task.findFirst({
      where: { AND: [{ id: taskId }, visible] },
      select: { id: true },
    });
    return row !== null;
  }

  /** Видимые из пачки (#641): один запрос вместо `isVisible` на ссылку. */
  async visibleIds(taskIds: readonly string[], visible: Prisma.TaskWhereInput): Promise<string[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.prisma.task.findMany({
      where: { AND: [{ id: { in: [...taskIds] } }, visible] },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Счётчики колонок глобальной оси (count + overdue) в рамках видимости. */
  async stageCounts(where: Prisma.TaskWhereInput, now: Date) {
    const [all, overdue] = await Promise.all([
      this.prisma.task.groupBy({ by: ['stageId'], where, _count: { _all: true } }),
      this.prisma.task.groupBy({
        by: ['stageId'],
        where: { AND: [where, overdueWhere(now)] },
        _count: { _all: true },
      }),
    ]);
    return { all, overdue };
  }

  async personalCounts(userId: string, where: Prisma.TaskWhereInput, now: Date) {
    const [all, overdue] = await Promise.all([
      this.prisma.taskPersonalPlacement.groupBy({
        by: ['stageId'],
        where: { userId, task: where },
        _count: { _all: true },
      }),
      this.prisma.taskPersonalPlacement.groupBy({
        by: ['stageId'],
        where: { userId, task: { AND: [where, overdueWhere(now)] } },
        _count: { _all: true },
      }),
    ]);
    return { all, overdue };
  }
}
