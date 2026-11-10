import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  pressConfigSchema,
  pressEntryResultOf,
  transitionFormSchema,
  type AuthUser,
  type PressReturnBody,
  type PressRoundView,
  type TransitionFormInput,
} from '@nodus/contracts';

import { TransactionRunner, type TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { actorRoles, taskAccess } from '../access/task-access.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { TimeService } from '../time/time.service.js';
import { CHAT_MESSAGE_ACCESS, type ChatMessageAccess } from '../../chat/message-access.port.js';
import { PressEvents } from './press-events.service.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import {
  WORKFLOW_PRESS_READER,
  type WorkflowPressReader,
} from '../../workflows/ports/workflow-press-reader.port.js';
import {
  WORKFLOW_RECORD_WRITER,
  type WorkflowRecordWriter,
} from '../../workflows/ports/workflow-record-writer.port.js';
import { PressRepository } from './press.repository.js';
import { PressRoundsService } from './press-rounds.service.js';

type PressTask = Awaited<ReturnType<TasksRepository['findWithParticipants']>>;

/**
 * Сдача/отзыв отметки сбора (#434). Одна транзакция и FOR UPDATE строки
 * задачи: два «последних» нажатия сериализуются, кворум срабатывает ровно
 * один раз. Участник заполняет личные разделы окна кнопки (время, итог,
 * комментарий); время пишется сразу его записью, итог — в press_entries.
 * При кворуме движок выполняет обычный переход с `pressCompletion`, а ввод
 * закрывающего становится итогом задачи и блоком перехода в чате.
 */
@Injectable()
export class PressService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly repo: PressRepository,
    private readonly rounds: PressRoundsService,
    private readonly tasks: TasksRepository,
    private readonly time: TimeService,
    @Inject(CHAT_MESSAGE_ACCESS) private readonly messages: ChatMessageAccess,
    @Inject(WORKFLOW_RECORD_WRITER) private readonly records: WorkflowRecordWriter,
    private readonly pressEvents: PressEvents,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
    @Inject(WORKFLOW_PRESS_READER) private readonly pressReader: WorkflowPressReader,
  ) {}

  submit(user: AuthUser, taskId: string, input: TransitionFormInput): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.submitInTx(tx, user, taskId, input));
  }

  withdraw(user: AuthUser, taskId: string): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.withdrawInTx(tx, user, taskId));
  }

  /** Выборочный возврат (#434): ответственный возвращает результаты тех, кому
   *  нужно доработать; остальные остаются сданными, раунд не закрывается. */
  returnEntries(
    user: AuthUser,
    taskId: string,
    body: PressReturnBody,
  ): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.returnInTx(tx, user, taskId, body));
  }

  private canManage(task: PressTask, user: AuthUser): boolean {
    return taskAccess(actorRoles(task, user.id), user.permissions).canEdit;
  }

  private async submitInTx(
    tx: TransactionClient,
    user: AuthUser,
    taskId: string,
    input: TransitionFormInput,
  ): Promise<PressRoundView | null> {
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const canManage = this.canManage(task, user);
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== task.stageId) {
      throw DomainException.notFound('Press round not found');
    }
    const entry = round.entries.find((item) => item.userId === user.id);
    if (!entry) throw DomainException.forbidden('Press is not allowed');
    if (entry.state === 'pressed') {
      // Идемпотентность повторного клика с новым ключом запроса.
      return this.rounds.viewForTask(taskId, round.stageId, user.id, canManage, tx);
    }
    const config = pressConfigSchema.parse(round.config);
    if (entry.state !== 'waiting' && entry.state !== 'returned') {
      throw DomainException.forbidden('Press is not allowed');
    }
    if (config.order === 'sequential') {
      const first = round.entries
        .filter((item) => item.state === 'waiting' || item.state === 'returned')
        .sort((a, b) => a.order - b.order)[0];
      if (first?.userId !== user.id) throw DomainException.forbidden('Press is not your turn');
    }
    const form = transitionFormSchema.parse(round.form);
    const check = this.pressReader.checkPressInput(form, input);
    if (check.missing.length > 0 || check.unexpected.length > 0) {
      throw new DomainException(
        ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
        'Press form input is invalid',
        { transitionId: round.transitionId, ...check },
      );
    }

    const timeEntry =
      input.time && form.sections.some((section) => section.kind === 'time')
        ? await this.time.addManualInTx(
            tx,
            user.id,
            { id: task.id, projectId: task.projectId },
            input.time,
          )
        : null;
    const result = pressEntryResultOf(input);
    if (result.messageIds.length > 0) {
      // Чужие/удалённые/чужая беседа — одинаковый 404 (без оракула), как в
      // каноническом окне перехода: id из тела не доверяем (#434, security).
      const snaps = await this.messages.taskMessages(
        taskId,
        result.messageIds,
        user.id,
        tx,
      );
      if (snaps.length !== result.messageIds.length) {
        throw DomainException.notFound('Message not found');
      }
      result.fileCount = snaps.reduce((sum, snap) => sum + snap.attachmentCount, 0);
    }
    await this.repo.updateEntry(tx, entry.id, {
      state: 'pressed',
      pressedAt: new Date(),
      input,
      result,
      timeEntryId: timeEntry?.id ?? null,
      returnReason: null,
    });
    await this.records.write(tx, {
      entityKind: 'task',
      entityId: taskId,
      transitionId: round.transitionId,
      stageId: round.stageId,
      actorId: user.id,
      recordKind: 'press',
      participantId: user.id,
      comment: result.text || input.comment || null,
      fields: input as unknown as Record<string, unknown>,
      timeEntryId: timeEntry?.id ?? null,
    });
    const pressed = round.entries.filter(
      (item) => item.state === 'pressed' || item.userId === user.id,
    ).length;
    const total = round.entries.filter((item) => item.state !== 'excluded').length;
    const broadcast = this.pressEvents.isBroadcast(config);
    await this.pressEvents.updated(tx, task, user.id, round, config);
    if (!broadcast) {
      await this.pressEvents.submitted(
        tx,
        task,
        user.id,
        round.transitionName,
        result,
        pressed,
        total,
      );
    }

    const required =
      config.quorum.kind === 'all'
        ? total
        : config.quorum.kind === 'any'
          ? 1
          : Math.min(config.quorum.count, total);
    if (pressed < required) {
      return this.rounds.viewForTask(taskId, round.stageId, user.id, canManage, tx);
    }

    // Кворум: переход выполняет движок, ввод закрывающего — итог и блок в чате.
    await this.repo.completeRound(tx, round.id, new Date());
    const closing: TransitionFormInput = {
      ...(input.result ? { result: input.result } : {}),
      ...(input.comment ? { comment: input.comment } : {}),
    };
    await this.engine.execute(
      tx,
      taskId,
      'task',
      user,
      { transitionId: round.transitionId },
      { pressCompletion: true, ...(Object.keys(closing).length > 0 ? { form: closing } : {}) },
    );
    return null;
  }

  private async withdrawInTx(
    tx: TransactionClient,
    user: AuthUser,
    taskId: string,
  ): Promise<PressRoundView | null> {
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const canManage = this.canManage(task, user);
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== task.stageId) {
      throw DomainException.notFound('Press round not found');
    }
    const entry = round.entries.find((item) => item.userId === user.id);
    if (!entry) throw DomainException.forbidden('Press is not allowed');
    if (entry.state !== 'pressed') {
      return this.rounds.viewForTask(taskId, round.stageId, user.id, canManage, tx);
    }
    if (entry.timeEntryId) await this.time.removeInTx(tx, user.id, entry.timeEntryId);
    await this.repo.updateEntry(tx, entry.id, {
      state: 'waiting',
      pressedAt: null,
      input: null,
      result: null,
      timeEntryId: null,
    });
    await this.records.write(tx, {
      entityKind: 'task',
      entityId: taskId,
      transitionId: round.transitionId,
      stageId: round.stageId,
      actorId: user.id,
      recordKind: 'withdraw',
      participantId: user.id,
    });
    const config = pressConfigSchema.parse(round.config);
    await this.pressEvents.updated(tx, task, user.id, round, config);
    return this.rounds.viewForTask(taskId, round.stageId, user.id, canManage, tx);
  }

  private async returnInTx(
    tx: TransactionClient,
    user: AuthUser,
    taskId: string,
    body: PressReturnBody,
  ): Promise<PressRoundView | null> {
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    if (!this.canManage(task, user)) throw DomainException.forbidden('Press return is not allowed');
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== task.stageId) {
      throw DomainException.notFound('Press round not found');
    }
    const requested = new Set(body.userIds);
    const targets = round.entries.filter(
      (item) => requested.has(item.userId) && item.state === 'pressed',
    );
    if (targets.length === 0) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'No pressed entries to return',
        { userIds: body.userIds },
      );
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
