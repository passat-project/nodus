import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { AssistantRepository, type ActionBatchRow } from '../assistant.repository.js';
import type { ScreenContext } from '../tools/tool-definition.js';
import { AgentRunnerService } from './agent-runner.service.js';

/** Контекст экрана продолжающего прогона: карточки — не «открытая запись». */
const EMPTY_SCREEN: ScreenContext = { moduleId: null, cardKind: null, cardId: null };

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
 */
@Injectable()
export class AssistantContinuationService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly runner: AgentRunnerService,
    private readonly featureFlags: FeatureFlagService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AssistantContinuationService.name);
  }

  /**
   * После решения по карточке: если пачка открыта и все карточки решены —
   * захватить пачку и запустить ровно один прогон-продолжение.
   * Возвращает id прогона либо `null` (продолжение не требуется/невозможно).
   */
  async afterDecision(
    user: AuthUser,
    authorization: string,
    messageId: string | null,
  ): Promise<string | null> {
    if (!messageId) return null;
    const batch = await this.repo.findActionBatch(user.id, messageId);
    if (!batch || batch.state !== 'open') return null;

    const { pending } = await this.repo.countActionsByMessage(messageId);
    if (pending > 0) return null;

    // Исходный прогон ещё печатает ответ: два прогона в одной сессии
    // писали бы параллельно. Пачка остаётся открытой — сотрудник увидит
    // «Продолжить сейчас» после завершения.
    if (this.runner.isActive(batch.runId)) return null;

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
    if (!(await this.repo.claimBatchContinuation(messageId, runId))) {
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
    // Повторный клик после автопродолжения — тот же прогон, без дубля.
    if (batch.state === 'continued' && batch.continuationRunId) return batch.continuationRunId;
    if (batch.state === 'closed') {
      throw new DomainException(
        ErrorCode.CONFLICT,
        'Пачка уже закрыта: агент ответит на сообщение',
      );
    }
    if (this.runner.isActive(batch.runId)) {
      throw new DomainException(ErrorCode.CONFLICT, 'Ответ ещё печатается — дождитесь завершения');
    }

    const closed = await this.repo.claimBatchContinueNow(messageId);
    if (!closed) throw DomainException.notFound('Пачка действий не найдена');
    if (closed.state === 'continued' && closed.continuationRunId) {
      return closed.continuationRunId;
    }
    const { pending } = await this.repo.countActionsByMessage(messageId);
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
    await this.start(user, authorization, batch, runId, pending);
    return runId;
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
