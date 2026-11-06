import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import { ViewerResolver, visibleTasksWhere } from '../access/task-visibility.js';
import { TasksQueryRepository } from '../tasks/tasks-query.repository.js';
import type { TaskRefInfo, TaskRefReader, TaskRefViewer } from './task-ref-reader.port.js';

/**
 * Реализация read-порта задач для ссылок атрибутов (Р5 #631): видимость —
 * та же функция, что у списка задач (участие + конфиденциальность + надзор);
 * наружу только интерфейс порта, таблицы задач читает модуль tasks.
 */
@Injectable()
export class TaskRefReaderProvider implements TaskRefReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reads: TasksQueryRepository,
    private readonly viewers: ViewerResolver,
  ) {}

  async refs(taskIds: readonly string[]): Promise<TaskRefInfo[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.prisma.task.findMany({
      where: { id: { in: [...taskIds] } },
      select: { id: true, title: true, deletedAt: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.title, deleted: row.deletedAt !== null }));
  }

  async visibleFor(taskId: string, viewer: TaskRefViewer): Promise<boolean> {
    return (await this.visibleForMany([taskId], viewer)).has(taskId);
  }

  async visibleForMany(
    taskIds: readonly string[],
    viewer: TaskRefViewer,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<ReadonlySet<string>> {
    if (taskIds.length === 0) return new Set();
    const resolved = await this.viewers.resolve(viewer);
    const where = visibleTasksWhere(resolved, 'all', opts);
    const ids = await this.reads.visibleIds([...new Set(taskIds)], where);
    return new Set(ids);
  }
}
