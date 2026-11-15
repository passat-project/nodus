import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ErrorCode,
  Permission,
  TASK_EVENTS,
  type AuthUser,
  type Paginated,
  type RunningTimer,
  type TimeEntry,
  type TimeEntryCreateBody,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import { companyDate } from '../../../core/time/company-time.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { actorRoles, audienceIds, taskAccess } from '../access/task-access.js';
import { TasksQueryService } from '../tasks/tasks-query.service.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { TimeEntriesRepository } from './time-entries.repository.js';

/** Потолок одной записи таймера (забытый на ночь таймер не пишет сутки+). */
const TIMER_CAP_MINUTES = 1440;
const cursorSchema = z.object({ t: z.iso.datetime(), id: z.uuid() });

type EntryRow = {
  id: string;
  taskId: string | null;
  userId: string;
  minutes: number;
  date: Date;
  method: string;
  startedAt: Date | null;
  endedAt: Date | null;
  comment: string | null;
  createdAt: Date;
};

/** Идущая запись таймера (ещё не остановлена). */
export function isRunningTimer(entry: { method: string; endedAt: Date | null }): boolean {
  return entry.method === 'timer' && entry.endedAt === null;
}

/**
 * Трудозатраты (I14): ручные записи и таймер (один идущий на сотрудника —
 * частичный unique; старт нового останавливает старый). spentMinutes задачи
 * пересчитывается в той же транзакции. Пишут ответственный и соисполнители.
 */
@Injectable()
export class TimeService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly query: TasksQueryService,
    private readonly repo: TimeEntriesRepository,
    private readonly tasks: TasksRepository,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  async list(
    user: AuthUser,
    taskId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<TimeEntry>> {
    await this.query.visibleRow(user, taskId);
    const after = cursor ? decodeCursor(cursor, cursorSchema) : undefined;
    const rows = await this.repo.pageByTask(
      taskId,
      after ? { t: new Date(after.t), id: after.id } : undefined,
      limit,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.toDtos(page),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async add(user: AuthUser, taskId: string, body: TimeEntryCreateBody): Promise<TimeEntry> {
    const row = await this.assertCanLog(user, taskId);
    const entry = await this.txRunner.run((tx) =>
      this.addManualInTx(tx, user.id, { id: row.id, projectId: row.projectId }, body),
    );
    return (await this.toDtos([entry]))[0]!;
  }

  /** Ручная запись в транзакции вызывающего (#380: окно перехода пишет время
   *  той же логикой, что и «Внести время»; право canLogTime проверяет
   *  вызывающий по свежим ролям). Возвращает созданную строку. */
  async addManualInTx(
    tx: TransactionClient,
    actorId: string,
    task: { id: string; projectId: string | null },
    body: TimeEntryCreateBody,
  ): Promise<EntryRow> {
    const created = await this.repo.createManual(tx, {
      taskId: task.id,
      projectId: task.projectId,
      userId: actorId,
      minutes: body.minutes,
      date: new Date(`${body.date}T00:00:00Z`),
      comment: body.comment ?? null,
    });
    await this.logged(tx, actorId, task.id, created.id, created.minutes);
    return created;
  }

  async remove(user: AuthUser, entryId: string): Promise<void> {
    const entry = await this.repo.findById(entryId);
    if (!entry?.taskId) throw DomainException.notFound('Time entry not found');
    await this.query.visibleRow(user, entry.taskId);
    if (entry.userId !== user.id && !user.permissions.includes(Permission.TASK_MANAGE_ANY)) {
      throw DomainException.forbidden('Only author can delete time entry');
    }
    // Идущий таймер удалением не снимается: запись исчезла бы без
    // task.timer_stopped (виджет таймера у сотрудника завис бы). Сначала —
    // «Стоп» (каноничная остановка с событиями), затем удаление записи.
    if (isRunningTimer(entry)) {
      throw DomainException.conflict('Running timer cannot be deleted, stop it first');
    }
    await this.txRunner.run(async (tx) => {
      await this.repo.delete(tx, entryId);
      await this.logged(tx, user.id, entry.taskId!, entryId, -entry.minutes);
    });
  }

  async current(user: AuthUser): Promise<RunningTimer | null> {
    const entry = await this.repo.findRunningTimerWithTask(user.id);
    if (!entry?.task || !entry.startedAt) return null;
    // Доступ к задаче потерян (сняли с задачи) — название не раскрываем;
    // запись остановится стартом следующего таймера или явной остановкой.
    const visible = await this.query.visibleRow(user, entry.task.id).then(
      () => true,
      () => false,
    );
    if (!visible) return null;
    return { entryId: entry.id, task: entry.task, startedAt: entry.startedAt.toISOString() };
  }

  async start(user: AuthUser, taskId: string): Promise<RunningTimer> {
    const row = await this.assertCanLog(user, taskId);
    await this.txRunner.run(async (tx) => {
      await this.stopRunning(tx, user.id);
      const now = new Date();
      const entry = await this.repo.createTimer(tx, {
        taskId,
        projectId: row.projectId,
        userId: user.id,
        date: new Date(`${companyDate(now)}T00:00:00Z`),
        startedAt: now,
      });
      await this.eventBus.emit(
        tx,
        TASK_EVENTS.TIMER_STARTED,
        { taskId, number: row.number, audience: [user.id], entryId: entry.id, userId: user.id },
        { actorId: user.id, aggregateType: 'task', aggregateId: taskId },
      );
    });
    return (await this.current(user))!;
  }

  async stop(user: AuthUser): Promise<void> {
    const stopped = await this.txRunner.run((tx) => this.stopRunning(tx, user.id));
    if (!stopped)
      throw new DomainException(ErrorCode.TASK_TIMER_NOT_RUNNING, 'Timer is not running');
  }

  private async stopRunning(tx: TransactionClient, userId: string): Promise<boolean> {
    const running = await this.repo.findRunningTimer(userId, tx);
    if (!running?.startedAt) return false;
    const now = new Date();
    // Округление честное, без принудительного минимума: пробежка <30 сек
    // закрывается записью на 0 мин — след запуска в журнале есть, а
    // фантомных минут в spent нет (10 старт-стопов по секунде ≠ +10 мин,
    // вердикт владельца 24.10.2026). Гейт time_logged на spent>0 такая
    // запись не откроет — клик туда-сюда «учёт времени» не имитирует.
    const minutes = Math.min(
      TIMER_CAP_MINUTES,
      Math.round((now.getTime() - running.startedAt.getTime()) / 60_000),
    );
    await this.repo.closeTimer(tx, running.id, now, minutes);
    if (running.taskId) {
      const number = await this.tasks.numberOf(tx, running.taskId);
      await this.eventBus.emit(
        tx,
        TASK_EVENTS.TIMER_STOPPED,
        {
          taskId: running.taskId,
          number,
          audience: [userId],
          entryId: running.id,
          userId,
        },
        { actorId: userId, aggregateType: 'task', aggregateId: running.taskId },
      );
      await this.logged(tx, userId, running.taskId, running.id, minutes);
    }
    return true;
  }

  private async assertCanLog(user: AuthUser, taskId: string) {
    const row = await this.query.visibleRow(user, taskId);
    if (!taskAccess(actorRoles(row, user.id), user.permissions).canLogTime) {
      throw DomainException.forbidden('Time logging not allowed');
    }
    return row;
  }

  /** Пересчёт spentMinutes в той же tx + событие (delta < 0 — удаление). */
  private async logged(
    tx: TransactionClient,
    actorId: string,
    taskId: string,
    entryId: string,
    delta: number,
  ) {
    const task = await this.repo.recalcSpentMinutes(tx, taskId);
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.TIME_LOGGED,
      {
        taskId,
        number: task.number,
        audience: audienceIds(task),
        entryId,
        userId: actorId,
        minutes: delta,
        spentMinutes: task.spentMinutes,
      },
      { actorId, aggregateType: 'task', aggregateId: taskId },
    );
  }

  private async toDtos(rows: EntryRow[]): Promise<TimeEntry[]> {
    const refs = new Map(
      (await this.profiles.findRefs([...new Set(rows.map((r) => r.userId))])).map((r) => [r.id, r]),
    );
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      user: refs.get(r.userId) ?? { id: r.userId, displayName: '—', avatarUrl: null },
      minutes: r.minutes,
      date: r.date.toISOString().slice(0, 10),
      method: r.method as TimeEntry['method'],
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
