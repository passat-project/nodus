import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  pressConfigSchema,
  pressEntryResultOf,
  TASK_EVENTS,
  transitionFormSchema,
  type AuthUser,
  type PressRoundView,
  type TransitionFormInput,
} from '@nodus/contracts';

import { TransactionRunner, type TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { audienceIds } from '../access/task-access.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { TimeService } from '../time/time.service.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import {
  WORKFLOW_PRESS_READER,
  type WorkflowPressReader,
} from '../../workflows/ports/workflow-press-reader.port.js';
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
    private readonly events: EventBus,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
    @Inject(WORKFLOW_PRESS_READER) private readonly pressReader: WorkflowPressReader,
  ) {}

  submit(user: AuthUser, taskId: string, input: TransitionFormInput): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.submitInTx(tx, user, taskId, input));
  }

  withdraw(user: AuthUser, taskId: string): Promise<PressRoundView | null> {
    return this.txRunner.run(async (tx) => this.withdrawInTx(tx, user, taskId));
  }

  private async submitInTx(
    tx: TransactionClient,
    user: AuthUser,
    taskId: string,
    input: TransitionFormInput,
  ): Promise<PressRoundView | null> {
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== task.stageId) {
      throw DomainException.notFound('Press round not found');
    }
    const entry = round.entries.find((item) => item.userId === user.id);
    if (!entry) throw DomainException.forbidden('Press is not allowed');
    if (entry.state === 'pressed') {
      // Идемпотентность повторного клика с новым ключом запроса.
      return this.rounds.viewForTask(taskId, round.stageId, user.id, tx);
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
    await this.repo.updateEntry(tx, entry.id, {
      state: 'pressed',
      pressedAt: new Date(),
      input,
      result: pressEntryResultOf(input),
      timeEntryId: timeEntry?.id ?? null,
      returnReason: null,
    });
    await this.emitPressUpdated(tx, task, user.id);

    const pressed = round.entries.filter(
      (item) => item.state === 'pressed' || item.userId === user.id,
    ).length;
    const total = round.entries.filter((item) => item.state !== 'excluded').length;
    const required =
      config.quorum.kind === 'all'
        ? total
        : config.quorum.kind === 'any'
          ? 1
          : config.quorum.count;
    if (pressed < required) {
      return this.rounds.viewForTask(taskId, round.stageId, user.id, tx);
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
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== task.stageId) {
      throw DomainException.notFound('Press round not found');
    }
    const entry = round.entries.find((item) => item.userId === user.id);
    if (!entry) throw DomainException.forbidden('Press is not allowed');
    if (entry.state !== 'pressed') {
      return this.rounds.viewForTask(taskId, round.stageId, user.id, tx);
    }
    if (entry.timeEntryId) await this.time.removeInTx(tx, user.id, entry.timeEntryId);
    await this.repo.updateEntry(tx, entry.id, {
      state: 'waiting',
      pressedAt: null,
      input: null,
      result: null,
      timeEntryId: null,
    });
    await this.emitPressUpdated(tx, task, user.id);
    return this.rounds.viewForTask(taskId, round.stageId, user.id, tx);
  }

  /** Сигнал остальным: прогресс в карточке перечитать (payload task.updated). */
  private async emitPressUpdated(tx: TransactionClient, task: PressTask, actorId: string) {
    await this.events.emit(
      tx,
      TASK_EVENTS.UPDATED,
      {
        taskId: task.id,
        number: task.number,
        audience: audienceIds(task),
        fields: ['press'],
      },
      { actorId, aggregateType: 'task', aggregateId: task.id },
    );
  }
}
