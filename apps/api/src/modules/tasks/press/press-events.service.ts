import { Injectable } from '@nestjs/common';
import { pressEntryResultOf, TASK_EVENTS, type PressConfig } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { audienceIds } from '../access/task-access.js';
import type { TasksRepository } from '../tasks/tasks.repository.js';

type PressTask = Awaited<ReturnType<TasksRepository['findWithParticipants']>>;
type RoundEntries = { entries: readonly { userId: string }[] };

/**
 * События сбора отметок (#434): прогресс карточки, блоки чата и адресные
 * уведомления. Вынесено из PressService (I5): сервис держит транзакцию и
 * правила кворума, а адресация/анти-спам живут здесь.
 *
 * «Все сотрудники» — broadcast-раунд: блоки чата не пишутся и персональные
 * уведомления о старте не рассылаются (запрос виден в «Моих задачах»);
 * возврат остаётся адресным — уведомление получает только возвращённый.
 */
@Injectable()
export class PressEvents {
  constructor(private readonly events: EventBus) {}

  isBroadcast(config: Pick<PressConfig, 'sources'>): boolean {
    return config.sources.some((source) => source.kind === 'all_employees');
  }

  /** Прогресс в карточке перечитать (payload task.updated): обычные роли
   *  задачи + участники адресного раунда (могут быть вне ролей). */
  async updated(
    tx: TransactionClient,
    task: PressTask,
    actorId: string,
    round: RoundEntries,
    config: Pick<PressConfig, 'sources'>,
  ): Promise<void> {
    await this.events.emit(
      tx,
      TASK_EVENTS.UPDATED,
      {
        taskId: task.id,
        number: task.number,
        audience: this.audience(task, round, this.isBroadcast(config)),
        fields: ['press'],
      },
      { actorId, aggregateType: 'task', aggregateId: task.id },
    );
  }

  /** Сдача отметки в чат малых раундов: «Иванов сдал результат». */
  async submitted(
    tx: TransactionClient,
    task: PressTask,
    actorId: string,
    transitionName: string,
    result: ReturnType<typeof pressEntryResultOf>,
    pressed: number,
    total: number,
  ): Promise<void> {
    await this.events.emit(
      tx,
      TASK_EVENTS.PRESS_SUBMITTED,
      {
        taskId: task.id,
        number: task.number,
        title: task.title,
        audience: audienceIds(task),
        transitionName,
        broadcast: false,
        result: {
          text: result.text.slice(0, 500),
          fileCount: result.fileCount,
          minutes: result.minutes,
        },
        pressed,
        total,
      },
      { actorId, aggregateType: 'task', aggregateId: task.id },
    );
  }

  /** Возврат на доработку: личное уведомление каждому (даже в broadcast —
   *  действие адресное), блок чата слушатель пишет только для малых раундов. */
  async returned(
    tx: TransactionClient,
    task: PressTask,
    actorId: string,
    round: RoundEntries & { transitionName: string },
    userIds: string[],
    reason: string,
    broadcast: boolean,
  ): Promise<void> {
    await this.events.emit(
      tx,
      TASK_EVENTS.PRESS_RETURNED,
      {
        taskId: task.id,
        number: task.number,
        title: task.title,
        audience: [
          ...new Set([
            ...audienceIds(task),
            ...(broadcast ? userIds : round.entries.map((entry) => entry.userId)),
          ]),
        ],
        transitionName: round.transitionName,
        broadcast,
        userIds,
        reason,
      },
      { actorId, aggregateType: 'task', aggregateId: task.id },
    );
  }

  private audience(task: PressTask, round: RoundEntries, broadcast: boolean): string[] {
    return [
      ...new Set([
        ...audienceIds(task),
        ...(broadcast ? [] : round.entries.map((entry) => entry.userId)),
      ]),
    ];
  }
}
