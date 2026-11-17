import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
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
 * сессии писали бы параллельно, поэтому продолжение ОТКЛАДЫВАЕТСЯ до
 * завершения текущего прогона (`RunCompletionNotifier`), а сотруднику
 * доступна липкая строка «Продолжить сейчас» — запасной путь без таймеров.
 */
@Injectable()
export class AssistantContinuationService {
  /** Продолжения, ждущие завершения активного прогона сессии. */
  private readonly pendingResumes = new Map<string, PendingResume>();

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

    const { pending } = await this.repo.countActionsByMessage(messageId, user.id);
    if (pending > 0) return null;

    // Исходный прогон ещё печатает ответ: два прогона в одной сессии писали
    // бы параллельно. Откладываем до завершения (без таймера) — свежий
    // Authorization запроса решения живёт в памяти до этого момента.
    if (this.runner.isSessionActive(batch.sessionId)) {
      this.pendingResumes.set(batch.sessionId, { user, authorization, messageId });
      return null;
    }

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
    if (!(await this.repo.claimBatchContinuation(messageId, user.id, runId))) {
      // Параллельное решение уже продолжило пачку — чужой прогон не нужен.
      await this.repo.deleteRun(runId);
      return null;
    }
    await this.start(user, authorization, batch, runId, 0);
    return runId;
  }

  /**
   * «Продолжить сейчас»: явное решение сотрудника. Пачка закрывается для
   * автопродолжения, оставшиеся карточки остаются рабочими; агент продолжает
   * с тем, что решено, и упоминает ожидающие.
   */
  async continueNow(user: AuthUser, authorization: string, messageId: string): Promise<string> {
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
      throw new DomainException(ErrorCode.CONFLICT, 'Ответ ещё печатается — дождитесь завершения');
    }

    // Прогон создаётся ДО захвата: захват пишет его id в пачку. Гонка двух
    // кликов решается атомарным updateMany — проигравший удаляет свой прогон
    // и возвращает прогон победителя (I7, повторный клик без дубля).
    const { pending } = await this.repo.countActionsByMessage(messageId, user.id);
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
      if (current?.state === 'continued' && current.continuationRunId) {
        return current.continuationRunId;
      }
      if (current?.state === 'closed' && current.continuationRunId) {
        return current.continuationRunId;
      }
      throw new DomainException(
        ErrorCode.CONFLICT,
        'Пачка уже закрыта: агент ответит на сообщение',
      );
    }
    await this.start(user, authorization, batch, runId, pending);
    return runId;
  }

  /**
   * Завершение прогона сессии: если решение по последней карточке ждало
   * окончания печати — стартуем продолжение. Пачку перечитываем: за время
   * ожидания её могли закрыть новым сообщением или «Продолжить сейчас».
   */
  private async resumeAfterRun(sessionId: string): Promise<void> {
    const pending = this.pendingResumes.get(sessionId);
    if (!pending) return;
    this.pendingResumes.delete(sessionId);
    try {
      // В сессии уже мог начаться другой прогон (новый вопрос сотрудника).
      if (this.runner.isSessionActive(sessionId)) {
        this.pendingResumes.set(sessionId, pending);
        return;
      }
      const batch = await this.repo.findActionBatch(pending.user.id, pending.messageId);
      if (!batch || batch.state !== 'open') return;
      const { pending: waiting } = await this.repo.countActionsByMessage(
        pending.messageId,
        pending.user.id,
      );
      if (waiting > 0) return;
      const runId = randomUUID();
      await this.repo.createRun({
        id: runId,
        sessionId: batch.sessionId,
        userId: batch.userId,
        providerId: null,
        modelId: null,
        autoExecute: false,
        continuationOfMessageId: pending.messageId,
      });
      if (!(await this.repo.claimBatchContinuation(pending.messageId, pending.user.id, runId))) {
        await this.repo.deleteRun(runId);
        return;
      }
      await this.start(pending.user, pending.authorization, batch, runId, 0);
    } catch (error) {
      // Отложенное продолжение не должно ронять завершённый прогон; лента
      // остаётся с открытой пачкой и строкой «Продолжить сейчас».
      this.logger.warn(
        { err: error, sessionId, messageId: pending.messageId },
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
  ): Promise<void> {
    const features = await this.featureFlags.enabledModules();
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
    this.logger.info(
      { runId, messageId: batch.messageId, pendingCards },
      'Assistant continuation started',
    );
  }
}
