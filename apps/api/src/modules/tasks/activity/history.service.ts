import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TASK_EVENTS, type AuthUser, type Paginated, type TaskHistoryItem } from '@nodus/contracts';

import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { TasksQueryService } from '../tasks/tasks-query.service.js';
import { HistoryRepository } from './history.repository.js';

/** Личные события (доска/таймер конкретного сотрудника) в общую историю не идут. */
const PRIVATE_TYPES = [
  TASK_EVENTS.PERSONAL_STAGE_CHANGED,
  TASK_EVENTS.TIMER_STARTED,
  TASK_EVENTS.TIMER_STOPPED,
];
const cursorSchema = z.object({ seq: z.string().regex(/^\d+$/) });

/** Вкладка «История» — события task.* агрегата из event log (I9), свежие первыми. */
@Injectable()
export class HistoryService {
  constructor(
    private readonly repo: HistoryRepository,
    private readonly query: TasksQueryService,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  async list(
    user: AuthUser,
    taskId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<TaskHistoryItem>> {
    await this.query.visibleRow(user, taskId);
    const before = cursor ? BigInt(decodeCursor(cursor, cursorSchema).seq) : undefined;
    const rows = await this.repo.pageTaskEvents(taskId, PRIVATE_TYPES, before, limit);
    const page = rows.slice(0, limit);
    const actorIds = page.map((r) => r.actorId).filter((id): id is string => id !== null);
    const refs = new Map(
      (await this.profiles.findRefs([...new Set(actorIds)])).map((r) => [r.id, r]),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        // Адресаты доставки — служебные поля gateway, в историю не отдаём
        // (#433: deciderIds — тот же класс служебной адресации).
        const payload = { ...(r.payload as Record<string, unknown>) };
        delete payload.audience;
        delete payload.deciderIds;
        return {
          id: r.id,
          type: r.type,
          actor: r.actorId ? (refs.get(r.actorId) ?? null) : null,
          payload,
          createdAt: r.createdAt.toISOString(),
        };
      }),
      nextCursor: rows.length > limit && last ? encodeCursor({ seq: last.seq.toString() }) : null,
    };
  }
}
