import { randomUUID } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { AssistantRepository, type ActionBatchRow } from '../assistant.repository.js';
import type { ScreenContext } from '../tools/tool-definition.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { RunCompletionNotifier } from './run-completion.js';

/** Контекст экрана продолжающего прогона: карточки — не «открытая запись». */
const EMPTY_SCREEN: ScreenContext = { moduleId: null, cardKind: null, cardId: null };

/** Отложенное продолжение: решение пришло, пока исходный прогон печатал. */
interface PendingResume {
  user: AuthUser;
  authorization: string;
  messageId: string;
  /** Зарезервированный прогон: клиент получает его id сразу и подписывается. */
  runId: string;
}

/**
 * Продолжение прогона после решений по карточкам (#916).
 *
 * Карточка действия — вопрос с последствиями: одобрение сразу пишет в портал.
 * Продолжаем ОДИН раз и только когда решены ВСЕ карточки пачки (решение
 * владельца 18.11.2026): иначе лента уезжала бы вниз, а неодобренные карточки
 * терялись из виду. «Продолжить сейчас» и новое сообщение закрывают пачку для
 * автопродолжения, не отменяя карточки.
 *
 * Прогон-продолжение — отдельный прогон с fresh `Authorization` из запроса
 * решения, а не висящий SSE: окно можно закрыть, ответ сохранится в истории.
 *
 * Решение могло прийти, пока агент ещё печатал ответ. Два прогона одной
 * сессии писали бы параллельно, поэтому продолжение РЕЗЕРВИРУЕТСЯ (прогон и
 * захват пачки) и стартует по `RunCompletionNotifier` — без таймеров. Клиент
 * подписывается на зарезервированный прогон после завершения текущего потока.
 * «Стоп» отменяет и резерв; перезапуск API закрывает осиротевшие `queued`
 * (`onModuleInit`), возвращая пачки в `open`.
 */
@Injectable()
export class AssistantContinuationService implements OnModuleInit {
  /** Продолжения, ждущие завершения активного прогона сессии. */
  private readonly pendingResumes = new Map<string, PendingResume>();
  /**
   * Очередь стартов прогонов по сессии: проверка «прогон уже идёт» и
   * `runner.start` не атомарны, а входов несколько (`sendMessage`,
   * `afterDecision`, `continueNow`, отложенный резерв). Без общего гейта
   * сообщение, отправленное в окно между проверкой и стартом, создавало
   * второй параллельный прогон (валидация 18.11.2026). Один backend — I1.
   */
  private readonly starts = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repo: AssistantRepository,
    private readonly runner: AgentRunnerService,
    private readonly featureFlags: FeatureFlagService,
    private readonly completion: RunCompletionNotifier,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AssistantContinuationService.name);
    this.completion.register((sessionId) => {
      void this.resumeAfterRun(sessionId);
    });
  }

  /**
   * Резерв продолжения живёт только в памяти: после рестарта `queued`-прогоны
   * никогда не стартуют. Закрываем их `interrupted` и возвращаем пачки в
   * `open`, иначе «Продолжить сейчас» отдавал бы мёртвый runId.
   */
  async onModuleInit(): Promise<void> {
    try {
      const recovered = await this.repo.recoverQueuedRuns();
      if (recovered > 0) {
        this.logger.warn(
          { runs: recovered },
          'Зарезервированные продолжения прерваны перезапуском — пачки возвращены в работу',
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Не удалось восстановить queued-прогоны ассистента');
    }
  }

  /**
   * Сериализация стартов одной сессии (общий гейт для всех входов).
   * Хвост цепочки не несёт reject — ошибку получает только вызывающий.
   */
  async runExclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.starts.get(sessionId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(work);
    const tracked = task
      .catch(() => undefined)
      .finally(() => {
        if (this.starts.get(sessionId) === tracked) this.starts.delete(sessionId);
      });
    this.starts.set(sessionId, tracked);
    return task;
  }

  /**
   * После решения по карточке: если пачка открыта и все карточки решены —
   * захватить пачку и запустить ровно один прогон-продолжение.
   * Возвращает id прогона либо `null` (продолжение не требуется/отложено).
   */
  async afterDecision(
    user: AuthUser,
    authorization: string,
    messageId: string | null,
  ): Promise<string | null> {
    if (!messageId) return null;
    const batch = await this.repo.findActionBatch(user.id, messageId);
    if (!batch || batch.state !== 'open') return null;

    return this.runExclusive(batch.sessionId, async () => {
      // Перечитываем под гейтом: пока ждали очередь, пачку могли закрыть,
      // а в сессии — начать другой прогон.
      const current = await this.repo.findActionBatch(user.id, messageId);
      if (!current || current.state !== 'open') return null;
      const { pending } = await this.repo.countActionsByMessage(messageId, user.id);
      if (pending > 0) return null;

      // Модули читаем ДО захвата пачки: сбой чтения не должен оставлять
      // `continued` с прогоном, который никто не стартует.
      const features = await this.featureFlags.enabledModules();
      const runId = randomUUID();
      await this.repo.createRun({
        id: runId,
        sessionId: current.sessionId,
        userId: current.userId,
        providerId: null,
        modelId: null,
        autoExecute: false,
        continuationOfMessageId: messageId,
      });
      if (!(await this.repo.claimBatchContinuation(messageId, user.id, runId))) {
        // Параллельное решение уже продолжило пачку — чужой прогон не нужен.
        await this.repo.deleteRun(runId);
        return null;
      }
      // Исходный прогон ещё печатает ответ: прогон-продолжение
      // РЕЗЕРВИРУЕТСЯ и стартует по завершении печати без таймера. Свежий
      // Authorization запроса решения живёт в памяти до старта.
      if (this.runner.isSessionActive(current.sessionId)) {
        this.pendingResumes.set(current.sessionId, { user, authorization, messageId, runId });
        return runId;
      }
      await this.start(user, authorization, current, runId, 0, features);
      return runId;
    });
  }

  /**
   * «Продолжить сейчас»: явное решение сотрудника. Пачка закрывается для
   * автопродолжения, оставшиеся карточки остаются рабочими; агент продолжает
   * с тем, что решено, и упоминает ожидающие.
   */
  async continueNow(user: AuthUser, authorization: string, messageId: string): Promise<string> {
    const known = await this.repo.findActionBatch(user.id, messageId);
    if (!known) throw DomainException.notFound('Пачка действий не найдена');
    return this.runExclusive(known.sessionId, async () => {
      const batch = await this.repo.findActionBatch(user.id, messageId);
      if (!batch) throw DomainException.notFound('Пачка действий не найдена');
      // Повторный клик после автопродолжения/«Продолжить сейчас» — тот же
      // прогон, без дубля; закрытая без прогона пачка — новое сообщение.
      if (batch.continuationRunId) return batch.continuationRunId;
      if (batch.state === 'closed') {
        throw new DomainException(
          ErrorCode.CONFLICT,
          'Пачка уже закрыта: агент ответит на сообщение',
        );
      }
      if (this.runner.isSessionActive(batch.sessionId)) {
        throw new DomainException(
          ErrorCode.CONFLICT,
          'Ответ ещё печатается — дождитесь завершения',
        );
      }

      // Прогон создаётся ДО захвата: захват пишет его id в пачку. Гонка двух
      // кликов решается атомарным updateMany — проигравший удаляет свой прогон
      // и возвращает прогон победителя (I7, повторный клик без дубля).
      const { pending } = await this.repo.countActionsByMessage(messageId, user.id);
      // Модули — до захвата пачки: сбой чтения не оставит мёртвый `closed`.
      const features = await this.featureFlags.enabledModules();
      const runId = randomUUID();
      await this.repo.createRun({
        id: runId,
        sessionId: batch.sessionId,
        userId: batch.userId,
        providerId: null,
        modelId: null,
        autoExecute: false,
        continuationOfMessageId: messageId,
      });
      if (!(await this.repo.claimBatchContinueNow(messageId, user.id, runId))) {
        await this.repo.deleteRun(runId);
        const current = await this.repo.findActionBatch(user.id, messageId);
        if (current?.continuationRunId && current.state !== 'open') {
          return current.continuationRunId;
        }
        throw new DomainException(
          ErrorCode.CONFLICT,
          'Пачка уже закрыта: агент ответит на сообщение',
        );
      }
      await this.start(user, authorization, batch, runId, pending, features);
      return runId;
    });
  }

  /** Есть ли отложенное (зарезервированное) продолжение этой сессии. */
  hasPendingResume(sessionId: string): boolean {
    return this.pendingResumes.has(sessionId);
  }

  /**
   * Завершение прогона сессии: если решение по последней карточке ждало
   * окончания печати — стартуем ЗАРЕЗЕРВИРОВАННЫЙ прогон. Пачку перечитываем:
   * её могли закрыть/продолжить иначе за время ожидания.
   */
  private async resumeAfterRun(sessionId: string): Promise<void> {
    const waiting = this.pendingResumes.get(sessionId);
    if (!waiting) return;
    try {
      await this.runExclusive(sessionId, async () => {
        // Пока ждали гейт, резерв могли снять/пересоздать — сверяемся.
        const pending = this.pendingResumes.get(sessionId);
        if (!pending || pending.runId !== waiting.runId) return;
        // В сессии уже мог начаться другой прогон (новый вопрос сотрудника):
        // ждём его завершения — notifier позовёт снова.
        if (this.runner.isSessionActive(sessionId)) return;
        // Модули читаем до снятия резерва: сбой не оставит пачку в `continued`.
        const features = await this.featureFlags.enabledModules();
        this.pendingResumes.delete(sessionId);
        // «Стоп» мог отменить зарезервированный прогон, пока печатался
        // исходный: стартовать отменённый нельзя (иначе кнопка «Стоп»
        // ничего не останавливала бы).
        const reserved = await this.repo.findRunById(pending.runId);
        if (!reserved || reserved.status !== 'queued') return;
        const batch = await this.repo.findActionBatch(pending.user.id, pending.messageId);
        if (!batch || batch.state !== 'continued' || batch.continuationRunId !== pending.runId) {
          await this.repo.deleteRun(pending.runId);
          return;
        }
        await this.start(pending.user, pending.authorization, batch, pending.runId, 0, features);
      });
    } catch (error) {
      // Сбой старта не должен оставлять вечный резерв: снимаем его и
      // возвращаем пачку в работу («Продолжить сейчас» остаётся у сотрудника).
      this.pendingResumes.delete(sessionId);
      await this.repo.cancelQueuedRun(waiting.runId).catch(() => undefined);
      this.logger.warn(
        { err: error, sessionId, messageId: waiting.messageId },
        'Deferred continuation failed',
      );
    }
  }

  /** Запуск прогона-продолжения: тот же каталог прав, свежий токен решения. */
  private async start(
    user: AuthUser,
    authorization: string,
    batch: ActionBatchRow,
    runId: string,
    pendingCards: number,
    features: readonly string[],
  ): Promise<void> {
    try {
      this.runner.start({
        runId,
        sessionId: batch.sessionId,
        userId: user.id,
        authorization,
        permissions: user.permissions,
        features,
        screen: EMPTY_SCREEN,
        autoExecute: false,
        continuation: { ofMessageId: batch.messageId, pendingCards },
      });
    } catch (error) {
      // Синхронный сбой старта: снимаем резерв и возвращаем пачку в работу.
      await this.repo.cancelQueuedRun(runId).catch(() => undefined);
      throw error;
    }
    this.logger.info(
      { runId, messageId: batch.messageId, pendingCards },
      'Assistant continuation started',
    );
  }
}
