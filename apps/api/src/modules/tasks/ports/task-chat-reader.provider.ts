import { Injectable } from '@nestjs/common';
import type { TaskRef } from '@nodus/contracts';

import { TaskDecidersRepository } from '../access/task-deciders.repository.js';
import { TaskDeciders } from '../access/task-deciders.service.js';
import { ViewerResolver, visibleTasksWhere } from '../access/task-visibility.js';
import { TasksQueryRepository } from '../tasks/tasks-query.repository.js';
import type { TaskChatReader, TaskChatRoster } from './task-chat-reader.port.js';

/** Реализация read-порта задач для чата (таблицы задач — через репозиторий
 *  чтений модуля, наружу — только интерфейс порта). */
@Injectable()
export class TaskChatReaderProvider implements TaskChatReader {
  constructor(
    private readonly reads: TasksQueryRepository,
    private readonly deciderTasks: TaskDecidersRepository,
    private readonly viewers: ViewerResolver,
    private readonly deciders: TaskDeciders,
  ) {}

  async roster(taskId: string): Promise<TaskChatRoster | null> {
    const task = await this.reads.findLiveRoster(taskId);
    if (!task) return null;
    const members = new Map<string, boolean>([
      [task.creatorId, false],
      [task.assigneeId, false],
    ]);
    for (const p of task.participants) {
      if (!members.has(p.userId)) members.set(p.userId, p.role === 'observer');
    }
    return {
      creatorId: task.creatorId,
      members: [...members].map(([userId, muted]) => ({ userId, muted })),
    };
  }

  refs(taskIds: string[]): Promise<TaskRef[]> {
    if (taskIds.length === 0) return Promise.resolve([]);
    return this.reads.findRefs(taskIds);
  }

  async canView(
    taskId: string,
    user: { id: string; permissions: readonly string[] },
  ): Promise<boolean> {
    const viewer = await this.viewers.resolve(user);
    return this.reads.isVisible(taskId, visibleTasksWhere(viewer, 'all'));
  }

  /** Решающий текущего шага (#433): видимость уже включает его, но чат и
   *  файлы открываются только по этому признаку, не по любому view_all.
   *  Двойной гейт: видимость задачи (те же правила, что список) + источник. */
  async isDecider(taskId: string, userId: string): Promise<boolean> {
    const viewer = await this.viewers.resolve({ id: userId, permissions: [] });
    if (!(await this.reads.isVisible(taskId, visibleTasksWhere(viewer, 'all')))) return false;
    const task = await this.deciderTasks.findTask(taskId);
    if (!task) return false;
    return this.deciders.isDeciderNow(undefined, task, userId);
  }
}
