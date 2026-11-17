import { Injectable } from '@nestjs/common';
import type { AuthUser, AssistantAction, AssistantBatchDecision } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { AssistantContinuationService } from './agent/continuation.service.js';
import { AssistantActionsService } from './assistant-actions.service.js';
import { AssistantRepository } from './assistant.repository.js';
import { toActionDto } from './assistant.serializers.js';

/**
 * Решения по всей пачке карточек (#916): «Выполнить все» / «Отменить все».
 * Карточки проходят те же одиночные пути (идемпотентность, аудит, события) —
 * пачка лишь применяет решение к каждой; после последней запускается одно
 * продолжение по общим правилам.
 */
@Injectable()
export class AssistantBatchesService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly actions: AssistantActionsService,
    private readonly continuation: AssistantContinuationService,
  ) {}

  async executeAll(
    user: AuthUser,
    messageId: string,
    authorization: string,
  ): Promise<AssistantBatchDecision> {
    await this.requireBatch(user.id, messageId);
    for (const card of await this.repo.findActionsByMessage(user.id, messageId)) {
      if (card.state === 'proposed' || card.state === 'failed') {
        // Одна карточка не должна останавливать пачку: конфликт состояния
        // (параллельный клик) виден в итоговых состояниях карточек, а
        // остальные решения применяются, и продолжение запускается по ним.
        try {
          await this.actions.execute(user.id, card.id, authorization);
        } catch {
          // состояние карточки уже зафиксировано сервисом действий/БД
        }
      }
    }
    const continuationRunId = await this.continuation.afterDecision(user, authorization, messageId);
    return { actions: await this.cards(user.id, messageId), continuationRunId };
  }

  async cancelAll(
    user: AuthUser,
    messageId: string,
    authorization: string,
  ): Promise<AssistantBatchDecision> {
    await this.requireBatch(user.id, messageId);
    for (const card of await this.repo.findActionsByMessage(user.id, messageId)) {
      if (card.state === 'proposed' || card.state === 'failed') {
        try {
          await this.actions.cancel(user.id, card.id);
        } catch {
          // см. executeAll: пачка доводится до конца
        }
      }
    }
    const continuationRunId = await this.continuation.afterDecision(user, authorization, messageId);
    return { actions: await this.cards(user.id, messageId), continuationRunId };
  }

  private async requireBatch(userId: string, messageId: string): Promise<void> {
    const batch = await this.repo.findActionBatch(userId, messageId);
    if (!batch) throw DomainException.notFound('Пачка действий не найдена');
  }

  private async cards(userId: string, messageId: string): Promise<AssistantAction[]> {
    return (await this.repo.findActionsByMessage(userId, messageId)).map(toActionDto);
  }
}
