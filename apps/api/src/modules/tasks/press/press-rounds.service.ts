import { Inject, Injectable, Logger } from '@nestjs/common';
import { pressConfigSchema, type PressRoundView } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  WORKFLOW_PRESS_READER,
  type WorkflowPressReader,
} from '../../workflows/ports/workflow-press-reader.port.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { PressRepository } from './press.repository.js';
import { PressSourcesService } from './press-sources.service.js';
import { pressRoundViewOf } from './press-view.js';

/**
 * Жизненный цикл раунда сбора (#434): старт при входе задачи в стадию с
 * коллективной кнопкой, снимок источников и окна, чтение для карточки.
 * Один открытый раунд на задачу (partial unique); смена стадии/кнопки
 * закрывает прежний раунд. Пустой источник не блокирует задачу: раунда нет,
 * кнопка остаётся обычной (безопасный откат к обычному переходу).
 */
@Injectable()
export class PressRoundsService {
  private readonly logger = new Logger(PressRoundsService.name);

  constructor(
    private readonly repo: PressRepository,
    private readonly sources: PressSourcesService,
    private readonly tasks: TasksRepository,
    @Inject(WORKFLOW_PRESS_READER) private readonly pressReader: WorkflowPressReader,
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
  ) {}

  /** Вызывается в транзакции создания задачи и смены стадии. */
  async ensureForStage(
    tx: TransactionClient,
    taskId: string,
    stageId: string,
  ): Promise<void> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const transitions = (
      await this.pressReader.pressTransitionsForStage(task.workflowId, stageId, tx)
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    const transition = transitions[0];
    if (!transition) {
      await this.repo.cancelOpenRound(tx, 'task', taskId, new Date());
      return;
    }
    if (transitions.length > 1) {
      // Один раунд на задачу (контракт карточки); публикация обязана не
      // допускать две коллективные кнопки в стадии — до неё берём первую.
      this.logger.warn(
        `В стадии ${stageId} несколько коллективных кнопок — взят «${transition.name}»`,
      );
    }
    const open = await this.repo.findOpenRound(tx, 'task', taskId);
    if (open) {
      if (open.stageId === stageId && open.transitionId === transition.id) return;
      await this.repo.cancelOpenRound(tx, 'task', taskId, new Date());
    }
    const entries = await this.sources.resolve(tx, taskId, transition.press);
    if (entries.length === 0) {
      this.logger.warn(
        `Источники сбора «${transition.name}» не дали участников — раунд не создан`,
      );
      return;
    }
    await this.repo.createRound(tx, {
      entityKind: 'task',
      entityId: taskId,
      stageId,
      transitionId: transition.id,
      transitionName: transition.name,
      cycle: await this.repo.nextCycle(tx, 'task', taskId),
      config: transition.press,
      form: transition.form,
      entries,
    });
  }

  /** Есть ли открытый раунд (#434): false — источники пусты или задача
   *  вышла из стадии; движок разрешает обычный переход как fallback. */
  async hasOpenRound(tx: TransactionClient, taskId: string): Promise<boolean> {
    const round = await this.repo.findOpenRoundId(tx, 'task', taskId);
    return round !== null;
  }

  /** Коллективная кнопка, которую актор вправе нажать сейчас (для движка):
   *  участвует, ждёт/возвращён и его очередь по порядку. */
  async submittableTransitionIds(
    tx: TransactionClient,
    taskId: string,
    actorId: string,
  ): Promise<Set<string>> {
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round) return new Set();
    const config = pressConfigSchema.parse(round.config);
    const entry = round.entries.find((item) => item.userId === actorId);
    if (!entry || (entry.state !== 'waiting' && entry.state !== 'returned')) return new Set();
    if (config.order === 'sequential') {
      const firstWaiting = round.entries
        .filter((item) => item.state === 'waiting' || item.state === 'returned')
        .sort((a, b) => a.order - b.order)[0];
      if (firstWaiting?.userId !== actorId) return new Set();
    }
    return new Set([round.transitionId]);
  }

  /** Раунд текущей стадии для карточки; после кворума/смены стадии — null. */
  async viewForTask(
    taskId: string,
    stageId: string,
    viewerId: string,
    tx?: TransactionClient,
  ): Promise<PressRoundView | null> {
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== stageId) return null;
    const refs = await this.users.findRefs(
      [...new Set(round.entries.map((entry) => entry.userId))],
      tx,
    );
    const names = new Map(refs.map((ref) => [ref.id, ref.displayName]));
    return pressRoundViewOf(round, viewerId, (userId) => names.get(userId) ?? '—');
  }
}
