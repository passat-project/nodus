import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  pressConfigSchema,
  type AuthUser,
  type PressExcludeBody,
  type PressReturnBody,
  type PressRoundView,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { actorRoles, taskAccess } from '../access/task-access.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import {
  WORKFLOW_RECORD_WRITER,
  type WorkflowRecordWriter,
} from '../../workflows/ports/workflow-record-writer.port.js';
import { PressEvents } from './press-events.service.js';
import { PressRepository } from './press.repository.js';
import { PressRoundsService } from './press-rounds.service.js';

/**
 * Действия ответственного над открытым сбором (#434): выборочный возврат и
 * снятие участников. Вынесено из PressService (I5): там остаются сдача/отзыв
 * участника, здесь — управление составом раунда. Все операции идут в
 * транзакции с `FOR UPDATE` задачи; снятие пишет журнал `exclude`, возврат —
 * `return`, и при достигнутом после снятия кворуме движок выполняет переход.
 */
@Injectable()
export class PressAdminService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly repo: PressRepository,
    private readonly rounds: PressRoundsService,
    private readonly tasks: TasksRepository,
    @Inject(WORKFLOW_RECORD_WRITER) private readonly records: WorkflowRecordWriter,
    private readonly pressEvents: PressEvents,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
  ) {}

  returnEntries(
    user: AuthUser,
    taskId: string,
    body: PressReturnBody,
  ): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.returnInTx(tx, user, taskId, body));
  }

  excludeEntries(
    user: AuthUser,
    taskId: string,
    body: PressExcludeBody,
  ): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.excludeInTx(tx, user, taskId, body));
  }

  private async load(tx: TransactionClient, user: AuthUser, taskId: string) {
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    if (!taskAccess(actorRoles(task, user.id), user.permissions).canEdit) {
      throw DomainException.forbidden('Press action is not allowed');
    }
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== task.stageId) {
      throw DomainException.notFound('Press round not found');
    }
    return { task, round };
  }

  private async returnInTx(
    tx: TransactionClient,
    user: AuthUser,
    taskId: string,
    body: PressReturnBody,
  ): Promise<PressRoundView | null> {
    const { task, round } = await this.load(tx, user, taskId);
    const requested = new Set(body.userIds);
    const targets = round.entries.filter(
      (item) => requested.has(item.userId) && item.state === 'pressed',
    );
    if (targets.length === 0) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'No pressed entries to return', {
        userIds: body.userIds,
      });
    }
    for (const target of targets) {
      await this.repo.updateEntry(tx, target.id, {
        state: 'returned',
        returnReason: body.reason,
      });
      await this.records.write(tx, {
        entityKind: 'task',
        entityId: taskId,
        transitionId: round.transitionId,
        stageId: round.stageId,
        actorId: user.id,
        recordKind: 'return',
        participantId: target.userId,
        comment: body.reason,
        fields: { reason: body.reason },
      });
    }
    const config = pressConfigSchema.parse(round.config);
    await this.pressEvents.updated(tx, task, user.id, round, config);
    await this.pressEvents.returned(
      tx,
      task,
      user.id,
      round,
      targets.map((target) => target.userId),
      body.reason,
      this.pressEvents.isBroadcast(config),
    );
    return this.rounds.viewForTask(taskId, round.stageId, user.id, true, tx);
  }

  private async excludeInTx(
    tx: TransactionClient,
    user: AuthUser,
    taskId: string,
    body: PressExcludeBody,
  ): Promise<PressRoundView | null> {
    const { task, round } = await this.load(tx, user, taskId);
    const requested = new Set(body.userIds);
    const targets = round.entries.filter(
      (item) => requested.has(item.userId) && item.state !== 'excluded',
    );
    if (targets.length === 0) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'No entries to exclude', {
        userIds: body.userIds,
      });
    }
    const activeCount = round.entries.filter((item) => item.state !== 'excluded').length;
    if (targets.length === activeCount) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'At least one press participant must remain',
        { userIds: body.userIds },
      );
    }
    const targetIds = new Set(targets.map((target) => target.id));
    for (const target of targets) {
      await this.repo.updateEntry(tx, target.id, {
        state: 'excluded',
        returnReason: body.reason,
      });
      await this.records.write(tx, {
        entityKind: 'task',
        entityId: taskId,
        transitionId: round.transitionId,
        stageId: round.stageId,
        actorId: user.id,
        recordKind: 'exclude',
        participantId: target.userId,
        comment: body.reason,
        fields: { reason: body.reason },
      });
    }
    const active = round.entries.filter(
      (entry) => !targetIds.has(entry.id) && entry.state !== 'excluded',
    );
    const pressed = active.filter((entry) => entry.state === 'pressed').length;
    const total = active.length;
    const config = pressConfigSchema.parse(round.config);
    await this.pressEvents.updated(tx, task, user.id, { entries: active }, config);
    const required =
      config.quorum.kind === 'all'
        ? total
        : config.quorum.kind === 'any'
          ? 1
          : Math.min(config.quorum.count, total);
    if (pressed >= required) {
      await this.repo.completeRound(tx, round.id, new Date());
      await this.engine.execute(
        tx,
        taskId,
        'task',
        user,
        { transitionId: round.transitionId },
        { pressCompletion: true },
      );
      return null;
    }
    return this.rounds.viewForTask(taskId, round.stageId, user.id, true, tx);
  }
}
