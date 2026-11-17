import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  pressConfigSchema,
  type AuthUser,
  type DomainEvent,
  type DomainEventHandler,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  WORKFLOW_RECORD_WRITER,
  type WorkflowRecordWriter,
} from '../../workflows/ports/workflow-record-writer.port.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
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
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
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
      returnReason: 'Сотрудник деактивирован',
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
      comment: 'Сотрудник деактивирован',
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
    await this.repo.completeRound(tx, round.id, new Date());
    const actor = {
      id: task.assigneeId,
      email: 'system@nodus.local',
      displayName: 'Система',
      permissions: [],
    } as AuthUser;
    await tx.$executeRawUnsafe('SAVEPOINT press_exclusion');
    try {
      await this.engine.execute(
        tx,
        round.entityId,
        'task',
        actor,
        { transitionId: round.transitionId },
        { pressCompletion: true },
      );
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT press_exclusion');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT press_exclusion');
      await this.pressEvents.completionBlocked(tx, task, actor.id, round, this.reasonsOf(error));
    }
  }

  private reasonsOf(error: unknown): string[] {
    if (!(error instanceof DomainException)) return [];
    const details = error.details?.reasons;
    if (!Array.isArray(details)) return [error.message];
    return details.map((reason) => {
      if (reason && typeof reason === 'object' && 'kind' in reason) {
        return String((reason as { kind: unknown }).kind);
      }
      return error.message;
    });
  }
}
