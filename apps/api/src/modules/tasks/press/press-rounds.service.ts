import { Inject, Injectable, Logger } from '@nestjs/common';
import { pressConfigSchema, TASK_EVENTS, type PressRoundView } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  WORKFLOW_PRESS_READER,
  type WorkflowPressReader,
} from '../../workflows/ports/workflow-press-reader.port.js';
import { audienceIds } from '../access/task-access.js';
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
    private readonly events: EventBus,
    @Inject(WORKFLOW_PRESS_READER) private readonly pressReader: WorkflowPressReader,
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
  ) {}

  /** Вызывается в транзакции создания задачи и смены стадии. `notify` — только
   *  для путей-мутаций: ленивый старт при чтении карточки уведомлений не шлёт.
   *  Строка задачи блокируется, стадия берётся из свежего чтения: два
   *  параллельных открытия карточки не создают раунд дважды, а смена стадии
   *  между чтением и стартом не оставляет раунд в старом статусе.
   *  «Все сотрудники» считается broadcast-раундом: событие не эмитится, чтобы
   *  не рассылать уведомления по всему штату (анти-спам #434). */
  async ensureForStage(
    tx: TransactionClient,
    taskId: string,
    options: { notify?: boolean; actorId?: string | null } = {},
  ): Promise<void> {
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const stageId = task.stageId;
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
      this.logger.warn(`Источники сбора «${transition.name}» не дали участников — раунд не создан`);
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
    const broadcast = transition.press.sources.some((source) => source.kind === 'all_employees');
    if (options.notify && !broadcast) {
      await this.events.emit(
        tx,
        TASK_EVENTS.PRESS_REQUESTED,
        {
          taskId,
          number: task.number,
          title: task.title,
          audience: [...new Set([...audienceIds(task), ...entries.map((entry) => entry.userId)])],
          transitionName: transition.name,
          broadcast,
          participantIds: entries.map((entry) => entry.userId),
        },
        { actorId: options.actorId ?? null, aggregateType: 'task', aggregateId: taskId },
      );
    }
  }

  /** Задача удалена: открытый раунд закрывается, чтобы не держать публикацию
   *  маршрута и не оставлять «вечный» сбор (#434). */
  async cancelForTask(tx: TransactionClient, taskId: string): Promise<void> {
    await this.repo.cancelOpenRound(tx, 'task', taskId, new Date());
  }

  /** Снятие участника при открытом раунде запрещено (#434, security): иначе
   *  снятый сохраняет доступ через `pressTaskIds`, может закрыть задачу и
   *  одновременно блокирует кворум «все». Состав раунда — снимок на старте;
   *  сначала завершают сбор. */
  async assertCanRemove(
    tx: TransactionClient,
    taskId: string,
    userIds: readonly string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round) return;
    const wanted = new Set(userIds);
    const blocked = round.entries
      .filter((entry) => wanted.has(entry.userId) && entry.state !== 'excluded')
      .map((entry) => entry.userId);
    if (blocked.length > 0) {
      throw DomainException.conflict('Press round is open for these participants', {
        userIds: blocked,
      });
    }
  }

  /** Добавленный участник входит в открытый раунд отметкой «ждём» (#434):
   *  источник раунда решается заново, но только для этого человека. */
  async syncAdded(tx: TransactionClient, taskId: string, userId: string): Promise<void> {
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round) return;
    const existing = round.entries.find((entry) => entry.userId === userId);
    if (existing) {
      if (existing.state === 'excluded') {
        await this.repo.updateEntry(tx, existing.id, { state: 'waiting', returnReason: null });
      }
      return;
    }
    const config = pressConfigSchema.parse(round.config);
    const resolved = await this.sources.resolve(tx, taskId, config);
    if (!resolved.some((entry) => entry.userId === userId)) return;
    const order = Math.max(-1, ...round.entries.map((entry) => entry.order)) + 1;
    await this.repo.addEntry(tx, round.id, userId, order);
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
    canManage = false,
    tx?: TransactionClient,
  ): Promise<PressRoundView | null> {
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round || round.stageId !== stageId) return null;
    const refs = await this.users.findRefs(
      [...new Set(round.entries.map((entry) => entry.userId))],
      tx,
    );
    const names = new Map(refs.map((ref) => [ref.id, ref.displayName]));
    return pressRoundViewOf(round, viewerId, (userId) => names.get(userId) ?? '—', canManage);
  }
}
