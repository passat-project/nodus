import { Injectable } from '@nestjs/common';
import { isCompletedState, isFinalState, TASK_EVENTS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import type {
  WorkflowEntityStage,
  WorkflowStageChangeCause,
  WorkflowStageChangeMeta,
} from '../../../core/ports/workflow-entity.port.js';
import { audienceIds, planHolderIds } from '../access/task-access.js';
import { Placements } from '../personal/placements.js';
import { TasksRepository } from '../tasks/tasks.repository.js';

export interface MovableTask {
  id: string;
  number: number;
  stageId: string;
  systemState: string;
  creatorId: string;
  assigneeId: string;
  completedAt: Date | null;
  participants: { userId: string; role: string }[];
}

/** Почему меняется стадия (поле `cause` события stage_changed). */
export type StageChangeCause = WorkflowStageChangeCause;

/**
 * Общий доменный помощник смены стадии задачи (#378, спека фазы 3): правила
 * completedAt, автоперемещение «Моего плана» и события — в ОДНОЙ точке для
 * кнопок маршрута, фонового переноса публикации, смены типа и пересчёта
 * группы статуса (иначе — копии правил). Завершение — только вход в «Итог»
 * (фаза final, ADR-0020 дополнение 2): «Утверждение» (review) не ставит
 * completedAt и не шлёт task.completed. Вызывается ТОЛЬКО внутри
 * транзакции вызывающего сервиса.
 */
@Injectable()
export class StageMover {
  constructor(
    private readonly tasks: TasksRepository,
    private readonly placements: Placements,
    private readonly eventBus: EventBus,
  ) {}

  /** Смена стадии без проверок маршрута (вызывающий уже проверил).
   *  `meta` — общий тип движка (#380): типы сходятся TS-ом, а не глазами. */
  async apply(
    tx: TransactionClient,
    task: MovableTask,
    target: WorkflowEntityStage,
    actorId: string | null,
    meta: WorkflowStageChangeMeta,
  ): Promise<void> {
    const stateChanged = target.systemState !== task.systemState;
    await this.tasks.moveToStage(tx, task.id, {
      stageId: target.id,
      stageOrder: await this.tasks.stageKeyAt(tx, target.id, 0, task.id),
      ...this.stateFields(task, target.systemState),
    });
    const base = { taskId: task.id, number: task.number, audience: audienceIds(task) };
    const meta2 = { actorId, aggregateType: 'task', aggregateId: task.id };
    // Регресс #428: движок передаёт `overriddenGates`/`overrideReason`, а
    // помощник читал чужие имена — обход гейта терялся в событии.
    const overridden = meta.overriddenGates?.length ? meta.overriddenGates : undefined;
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.STAGE_CHANGED,
      {
        ...base,
        fromStageId: task.stageId,
        toStageId: target.id,
        toStageName: target.name,
        fromState: task.systemState,
        toState: target.systemState,
        toStageOutcome: target.outcome as 'success' | 'cancelled' | 'rejected' | null,
        transitionId: meta.transitionId,
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        coexecutorIds: task.participants
          .filter((p) => p.role === 'coexecutor')
          .map((p) => p.userId),
        cause: meta.cause,
        ...(overridden ? { overriddenGates: overridden, reason: meta.overrideReason } : {}),
        // Блок перехода в чате (#380): длины — лимиты контракта события.
        ...(meta.recordId ? { recordId: meta.recordId } : {}),
        ...(meta.transitionName ? { transitionName: meta.transitionName.slice(0, 32) } : {}),
        ...(meta.fromStageName ? { fromStageName: meta.fromStageName.slice(0, 40) } : {}),
        ...(meta.comment ? { comment: meta.comment.slice(0, 2000) } : {}),
        ...(meta.commentLabel ? { commentLabel: meta.commentLabel.slice(0, 60) } : {}),
        ...(meta.result ? { result: meta.result } : {}),
        ...(meta.deciderIds?.length ? { deciderIds: [...meta.deciderIds] } : {}),
      },
      meta2,
    );
    if (stateChanged) await this.afterStateChange(tx, task, target.systemState, actorId);
    // Выполнена: вход в «Итог» с исходом «выполнена» из незавершённого
    // (из работы или с утверждения); отмена — только stage_changed с
    // toStageOutcome: cancelled.
    const completes =
      isCompletedState(target.systemState, target.outcome) && !isFinalState(task.systemState);
    if (completes) {
      await this.eventBus.emit(
        tx,
        TASK_EVENTS.COMPLETED,
        { ...base, toState: target.systemState, stageName: target.name, creatorId: task.creatorId },
        meta2,
      );
    }
  }

  /** Стадия сменила группу (публикация маршрута): задача остаётся в своей
   *  стадии, пересчитываются состояние, completedAt и «Мой план». */
  async restate(tx: TransactionClient, task: MovableTask, systemState: string): Promise<void> {
    if (task.systemState === systemState) return;
    await this.tasks.setState(tx, task.id, this.stateFields(task, systemState));
    await this.afterStateChange(tx, task, systemState, null);
  }

  /** completedAt — момент входа в «Итог»: ставится при входе, сохраняется
   *  между итогами (отменена ↔ выполнена), снимается при выходе. */
  private stateFields(task: MovableTask, systemState: string) {
    const now = new Date();
    const stayedFinal = isFinalState(task.systemState) && task.completedAt !== null;
    return {
      systemState,
      ...(systemState !== task.systemState ? { stateChangedAt: now } : {}),
      completedAt: isFinalState(systemState) ? (stayedFinal ? task.completedAt : now) : null,
    };
  }

  private async afterStateChange(
    tx: TransactionClient,
    task: MovableTask,
    systemState: string,
    actorId: string | null,
  ): Promise<void> {
    await this.placements.sync(tx, { id: task.id, systemState }, planHolderIds(task), actorId);
    const base = { taskId: task.id, number: task.number, audience: audienceIds(task) };
    const meta = { actorId, aggregateType: 'task', aggregateId: task.id };
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.STATUS_CHANGED,
      { ...base, fromState: task.systemState, toState: systemState },
      meta,
    );
  }
}
