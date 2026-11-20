import { Inject, Injectable, Logger } from '@nestjs/common';
import { pressConfigSchema, TASK_EVENTS, ui, type PressRoundView } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  WORKFLOW_PRESS_READER,
  type WorkflowPressReader,
} from '../../workflows/ports/workflow-press-reader.port.js';
import {
  WORKFLOW_RECORD_WRITER,
  type WorkflowRecordWriter,
} from '../../workflows/ports/workflow-record-writer.port.js';
import { audienceIds } from '../access/task-access.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import { PressEvents } from './press-events.service.js';
import { PressRepository } from './press.repository.js';
import { PressSourcesService } from './press-sources.service.js';
import { pressRoundViewOf } from './press-view.js';

/** Итог проверки стадии для гардов смены стадии (#434/#705): настроена ли
 *  коллективная кнопка, удалось ли поднять раунд и не пусты ли источники. */
export interface PressStageState {
  /** Коллективная кнопка текущей стадии; null — такой кнопки нет. */
  transitionId: string | null;
  /** Раунд открыт (существующий или только что созданный). */
  roundStarted: boolean;
  /** Кнопка настроена, но источники не дали участников — кворум невозможен. */
  emptySources: boolean;
}

/**
 * Жизненный цикл раунда сбора (#434): старт при входе задачи в стадию с
 * коллективной кнопкой, снимок источников и окна, чтение для карточки.
 * Один открытый раунд на задачу (partial unique); смена стадии/кнопки
 * закрывает прежний раунд. «Приостановлена/Отложена» прогресс НЕ сбрасывает:
 * раунд переживает паузу и продолжается после «Продолжить» (решение владельца
 * 11.11.2026). Завершённый раунд остаётся читаемым (аналитика/CSV).
 */
@Injectable()
export class PressRoundsService {
  private readonly logger = new Logger(PressRoundsService.name);

  constructor(
    private readonly repo: PressRepository,
    private readonly sources: PressSourcesService,
    private readonly tasks: TasksRepository,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly events: EventBus,
    private readonly pressEvents: PressEvents,
    @Inject(WORKFLOW_PRESS_READER) private readonly pressReader: WorkflowPressReader,
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
    @Inject(WORKFLOW_RECORD_WRITER) private readonly records: WorkflowRecordWriter,
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
    options: {
      notify?: boolean;
      actorId?: string | null;
      /** Возврат в статус с коллективной кнопкой (#434, В2): кого вернуть;
       *  остальные сохраняют отметки прошлого цикла. */
      returnUserIds?: readonly string[];
    } = {},
  ): Promise<PressStageState> {
    // Порядок блокировок (#434, В6): проект → задача.
    const preliminary = await this.tasks.findWithParticipants(taskId, tx);
    if (preliminary.projectId) await this.projects.lockProject(tx, preliminary.projectId);
    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const stageId = task.stageId;
    const open = await this.repo.findOpenRound(tx, 'task', taskId);
    // Пауза прогресс сохраняет: раунд остаётся открытым, по «Продолжить»
    // карточка вернётся к тем же отметкам (решение владельца 11.11.2026).
    if (task.systemState === 'paused') {
      return { transitionId: null, roundStarted: open !== null, emptySources: false };
    }
    const transitions = (
      await this.pressReader.pressTransitionsForStage(task.workflowId, stageId, tx)
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    const transition = transitions[0];
    if (!transition) {
      await this.repo.cancelOpenRound(tx, 'task', taskId, new Date());
      return { transitionId: null, roundStarted: false, emptySources: false };
    }
    if (transitions.length > 1) {
      // Один раунд на задачу (контракт карточки); публикация обязана не
      // допускать две коллективные кнопки в стадии — до неё берём первую.
      this.logger.warn(
        `В стадии ${stageId} несколько коллективных кнопок — взят «${transition.name}»`,
      );
    }
    if (open) {
      if (open.stageId === stageId && open.transitionId === transition.id) {
        return { transitionId: transition.id, roundStarted: true, emptySources: false };
      }
      await this.repo.cancelOpenRound(tx, 'task', taskId, new Date());
    }
    const sourceEntries = await this.sources.resolve(tx, taskId, transition.press);
    const previous = options.returnUserIds?.length
      ? await this.repo.findLatestCompletedRound(tx, 'task', taskId)
      : null;
    // Возврат в тот же статус после полного сбора: выбранные снова видят
    // кнопку, остальные сохраняют отметки прошлого цикла (В2, 16.11).
    const seeded =
      previous &&
      previous.stageId === stageId &&
      previous.transitionId === transition.id &&
      previous.entries.length > 0
        ? previous.entries.map((entry) => {
            const selected = options.returnUserIds!.includes(entry.userId);
            if (entry.state === 'excluded') {
              return {
                userId: entry.userId,
                order: entry.order,
                state: 'excluded',
                returnReason: entry.returnReason ?? ui.tasks.press.excludedReason,
              };
            }
            // Выбранный начинает заново; невыбранный сохраняет отметку только
            // если реально сдавал. Остальные снова ждут — иначе «сдал» без
            // нажатия закрыл бы кворум нового цикла (security-аудит #707).
            if (selected) {
              return {
                userId: entry.userId,
                order: entry.order,
                state: 'returned',
                input: null,
                result: null,
                timeEntryId: null,
                returnReason: ui.tasks.press.returnedReason,
              };
            }
            if (entry.state === 'pressed') {
              return {
                userId: entry.userId,
                order: entry.order,
                state: 'pressed',
                pressedAt: entry.pressedAt,
                input: entry.input,
                result: entry.result,
                timeEntryId: entry.timeEntryId,
              };
            }
            // Невыбранный и не сдававший в прошлом цикле не должен снова
            // видеть кнопку: он вне нового состава (В2, «только выбранные»).
            return {
              userId: entry.userId,
              order: entry.order,
              state: 'excluded',
              returnReason: ui.tasks.press.excludedReason,
              input: null,
              result: null,
            };
          })
        : null;
    const entries =
      seeded ??
      sourceEntries.map((entry) => ({ ...entry, state: 'waiting' as string, input: null }));
    if (entries.length === 0) {
      this.logger.warn(`Источники сбора «${transition.name}» не дали участников — раунд не создан`);
      return { transitionId: transition.id, roundStarted: false, emptySources: true };
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
    const notifyIds = seeded
      ? seeded.filter((entry) => entry.state === 'returned').map((entry) => entry.userId)
      : entries.map((entry) => entry.userId);
    if (options.notify && !broadcast && notifyIds.length > 0) {
      await this.events.emit(
        tx,
        TASK_EVENTS.PRESS_REQUESTED,
        {
          taskId,
          number: task.number,
          title: task.title,
          audience: [...new Set([...audienceIds(task), ...notifyIds])],
          transitionName: transition.name,
          broadcast,
          participantIds: notifyIds,
        },
        { actorId: options.actorId ?? null, aggregateType: 'task', aggregateId: taskId },
      );
    }
    return { transitionId: transition.id, roundStarted: true, emptySources: false };
  }

  /** Задача удалена: открытый раунд закрывается, чтобы не держать публикацию
   *  маршрута и не оставлять «вечный» сбор (#434). */
  async cancelForTask(tx: TransactionClient, taskId: string): Promise<void> {
    await this.repo.cancelOpenRound(tx, 'task', taskId, new Date());
  }

  /** Снятие участника при открытом раунде (#434, security): снятый теряет
   *  доступ через `pressTaskIds` только после `excluded` — поэтому состав
   *  сбора приводится к составу задачи сразу, в той же транзакции (#965). */
  async syncRoster(
    tx: TransactionClient,
    taskId: string,
    reason: string,
    actorId: string | null = null,
  ): Promise<void> {
    const round = await this.repo.findOpenRound(tx, 'task', taskId);
    if (!round) return;
    const config = pressConfigSchema.parse(round.config);
    const resolved = await this.sources.resolve(tx, taskId, config);
    const eligible = new Set(resolved.map((entry) => entry.userId));
    const stale = round.entries.filter(
      (entry) => entry.state !== 'excluded' && !eligible.has(entry.userId),
    );
    // Вернувшегося в задачу нельзя оставить «снятым»: он снова в кворуме.
    const restored = round.entries.filter(
      (entry) => entry.state === 'excluded' && eligible.has(entry.userId),
    );
    const added = resolved.filter(
      (entry) => !round.entries.some((existing) => existing.userId === entry.userId),
    );
    if (stale.length === 0 && added.length === 0 && restored.length === 0) return;

    await this.tasks.lock(tx, taskId);
    const task = await this.tasks.findWithParticipants(taskId, tx);
    for (const entry of stale) {
      // Результат НЕ стирается: вклад остаётся в таблице и CSV (#965,
      // решение владельца 20.11.2026), человек лишь выходит из кворума.
      await this.repo.updateEntry(tx, entry.id, {
        state: 'excluded',
        returnReason: reason,
        timeEntryId: null,
      });
      await this.records.write(tx, {
        entityKind: 'task',
        entityId: taskId,
        transitionId: round.transitionId,
        stageId: round.stageId,
        actorId,
        recordKind: 'exclude',
        participantId: entry.userId,
        comment: reason,
      });
    }

    let order = Math.max(-1, ...round.entries.map((entry) => entry.order));
    for (const entry of restored) {
      // Вернулся — сдаёт заново: старый результат остаётся только в журнале,
      // иначе строка «Ждём» показывала бы чужую давность (#965).
      await this.repo.updateEntry(tx, entry.id, {
        state: 'waiting',
        returnReason: null,
        result: null,
      });
    }
    for (const entry of added) {
      order += 1;
      await this.repo.addEntry(tx, round.id, entry.userId, order);
    }

    const fresh = await this.repo.findRoundById(tx, round.id);
    if (!fresh) return;
    await this.pressEvents.updated(tx, task, actorId ?? task.assigneeId, fresh, config);

    const total = fresh.entries.filter((entry) => entry.state !== 'excluded').length;
    const pressed = fresh.entries.filter((entry) => entry.state === 'pressed').length;
    const required =
      config.quorum.kind === 'all'
        ? total
        : config.quorum.kind === 'any'
          ? 1
          : Math.min(config.quorum.count, total);
    this.logger.log(
      `Сбор ${taskId}: состав синхронизирован (снято ${stale.length}, добавлено ${added.length}, возвращено ${restored.length}); ${pressed}/${required}`,
    );
    if (total === 0 || pressed < required) return;
    // Переход «от имени» не выполняем — как при деактивации (#434, В3).
    await this.repo.completeRound(tx, round.id, new Date());
    await this.pressEvents.completionBlocked(tx, task, actorId, fresh, [
      ui.tasks.press.quorumAfterRemovalReason,
    ]);
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

  /** Раунд текущей стадии для карточки; после кворума — последний завершённый
   *  (read-only: аналитика/CSV остаются доступны, решение владельца 4A). */
  async viewForTask(
    taskId: string,
    stageId: string,
    viewerId: string,
    canManage = false,
    tx?: TransactionClient,
  ): Promise<PressRoundView | null> {
    const open = await this.repo.findOpenRound(tx, 'task', taskId);
    if (open) {
      if (open.stageId !== stageId) return null;
      return this.viewOf(open, viewerId, canManage, tx);
    }
    const latest = await this.repo.findLatestCompletedRound(tx, 'task', taskId);
    if (!latest) return null;
    return this.viewOf(latest, viewerId, canManage, tx);
  }

  /** Последний раунд без привязки к стадии — для ответа нажавшему, который
   *  после кворума потерял видимость задачи (#434, решение 2). */
  async viewLatestForTask(
    taskId: string,
    viewerId: string,
    canManage = false,
    tx?: TransactionClient,
  ): Promise<PressRoundView | null> {
    // Только раунд СВОЕЙ отметки: иначе внешний нажавший получает чужой
    // раунд следующей стадии (состав/результаты) — security-аудит #434.
    const round = await this.repo.findLatestRoundForUser(tx, 'task', taskId, viewerId);
    if (!round) return null;
    return this.viewOf(round, viewerId, canManage, tx);
  }

  private async viewOf(
    round: NonNullable<Awaited<ReturnType<PressRepository['findOpenRound']>>>,
    viewerId: string,
    canManage: boolean,
    tx?: TransactionClient,
  ): Promise<PressRoundView> {
    const refs = await this.users.findRefs(
      [...new Set(round.entries.map((entry) => entry.userId))],
      tx,
    );
    const names = new Map(refs.map((ref) => [ref.id, ref.displayName]));
    const avatars = new Map(refs.map((ref) => [ref.id, ref.avatarUrl ?? null]));
    return pressRoundViewOf(
      round,
      viewerId,
      (userId) => names.get(userId) ?? '—',
      canManage,
      (userId) => avatars.get(userId) ?? null,
    );
  }
}
