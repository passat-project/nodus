import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  pressConfigSchema,
  ui,
  type DomainEvent,
  type DomainEventHandler,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import {
  WORKFLOW_RECORD_WRITER,
  type WorkflowRecordWriter,
} from '../../workflows/ports/workflow-record-writer.port.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { PressEvents } from './press-events.service.js';
import { PressRepository } from './press.repository.js';

interface UserDeactivatedPayload {
  userId: string;
}

/**
 * Деактивация сотрудника (#434, В3): из открытых раундов он снимается
 * автоматически с причиной, кворум пересчитывается. Если после снятия кворум
 * собран — переход выполняется движком; сбой проверок оставляет отметки и
 * уведомляет ответственного (как В1).
 */
@Injectable()
export class TaskPressUserDeactivatedHandler implements DomainEventHandler<UserDeactivatedPayload> {
  static readonly eventType = DIRECTORY_EVENTS.USER_DEACTIVATED;

  private readonly logger = new Logger(TaskPressUserDeactivatedHandler.name);

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly repo: PressRepository,
    private readonly tasks: TasksRepository,
    private readonly pressEvents: PressEvents,
    @Inject(WORKFLOW_RECORD_WRITER) private readonly records: WorkflowRecordWriter,
  ) {}

  async handle(event: DomainEvent<UserDeactivatedPayload>): Promise<void> {
    const { userId } = event.payload;
    if (!userId) return;
    const rounds = await this.repo.findOpenRoundsForUser(userId);
    for (const round of rounds) {
      await this.txRunner.run(async (tx) => this.excludeInTx(tx, round.id, userId));
    }
  }

  private async excludeInTx(tx: TransactionClient, roundId: string, userId: string): Promise<void> {
    const round = await this.repo.findRoundById(tx, roundId);
    if (!round || round.completedAt || round.cancelledAt) return;
    const entry = round.entries.find((item) => item.userId === userId);
    if (!entry || entry.state === 'excluded') return;
    await this.tasks.lock(tx, round.entityId);
    await this.repo.updateEntry(tx, entry.id, {
      state: 'excluded',
      returnReason: ui.tasks.press.deactivatedReason,
      timeEntryId: null,
    });
    entry.state = 'excluded';
    await this.records.write(tx, {
      entityKind: 'task',
      entityId: round.entityId,
      transitionId: round.transitionId,
      stageId: round.stageId,
      actorId: null,
      recordKind: 'exclude',
      participantId: userId,
      comment: ui.tasks.press.deactivatedReason,
    });
    const config = pressConfigSchema.parse(round.config);
    const total = round.entries.filter((item) => item.state !== 'excluded').length;
    const pressed = round.entries.filter((item) => item.state === 'pressed').length;
    const required =
      config.quorum.kind === 'all'
        ? total
        : config.quorum.kind === 'any'
          ? 1
          : Math.min(config.quorum.count, total);
    this.logger.log(
      `Сбор ${round.entityId}: снят деактивированный ${userId}; ${pressed}/${required}`,
    );
    if (pressed < required) return;

    const task = await this.tasks.findWithParticipants(round.entityId, tx);
    // Кворум собран снятием: перехода «от имени» ответственного не делаем
    // (это подмена личности в журнале/событиях). Раунд закрывается, кнопка
    // становится обычной — ответственный нажимает сам.
    await this.repo.completeRound(tx, round.id, new Date());
    await this.pressEvents.completionBlocked(tx, task, null, round, [
      ui.tasks.press.quorumAfterRemovalReason,
    ]);
  }
}
