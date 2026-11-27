import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  pressConfigSchema,
  type AuthUser,
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
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  WORKFLOW_RECORD_WRITER,
  type WorkflowRecordWriter,
} from '../../workflows/ports/workflow-record-writer.port.js';
import { PressEvents } from './press-events.service.js';
import { PressRepository } from './press.repository.js';
import { PressRoundsService } from './press-rounds.service.js';

/**
 * Действия ответственного над открытым сбором (#434): выборочный возврат
 * отметок на доработку. Вынесено из PressService (I5): там остаются сдача и
 * отзыв участника, здесь — управление отметками. Операция идёт в транзакции
 * с `FOR UPDATE` задачи и пишет журнал `return`. Состав сбора меняет не он,
 * а синхронизация с составом задачи (#965, `PressRoundsService.syncRoster`).
 */
@Injectable()
export class PressAdminService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly repo: PressRepository,
    private readonly rounds: PressRoundsService,
    private readonly tasks: TasksRepository,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(WORKFLOW_RECORD_WRITER) private readonly records: WorkflowRecordWriter,
    private readonly pressEvents: PressEvents,
  ) {}

  returnEntries(
    user: AuthUser,
    taskId: string,
    body: PressReturnBody,
  ): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.returnInTx(tx, user, taskId, body));
  }

  private async load(tx: TransactionClient, user: AuthUser, taskId: string) {
    // Порядок блокировок (#434, В6): проект → задача.
    const preliminary = await this.tasks.findWithParticipants(taskId, tx);
    if (preliminary.projectId) await this.projects.lockProject(tx, preliminary.projectId);
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
}
