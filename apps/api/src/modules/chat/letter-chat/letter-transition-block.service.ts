import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  CHAT_EVENTS,
  type DomainEvent,
  type LetterStageChangedPayload,
  type StageColor,
} from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { ConversationMembersRepository } from '../conversations/conversation-members.repository.js';
import { ConversationsRepository } from '../conversations/conversations.repository.js';
import { MessageDtoMapper } from '../messages/message-dto.mapper.js';
import { MessagesWriteRepository } from '../messages/messages-write.repository.js';
import { VaultWriteRepository } from '../vault/vault-write.repository.js';
import { LetterChatService } from './letter-chat.service.js';

/**
 * Блок перехода письма в его чате (#55, Р10): обработчик
 * `correspondence.letter_stage_changed` с `recordId` и причиной пишет
 * сообщение `kind='letter_transition'` (автор — нажавший, текст — причина).
 * Цвет чипа цели берётся из стадии («Процессы» — порт каталога), в событии
 * его нет. Идемпотентность — `client_message_id` из id события.
 */
@Injectable()
export class LetterTransitionBlockService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly letterChat: LetterChatService,
    private readonly writes: MessagesWriteRepository,
    private readonly mapper: MessageDtoMapper,
    private readonly conversations: ConversationsRepository,
    private readonly memberships: ConversationMembersRepository,
    private readonly vault: VaultWriteRepository,
    private readonly eventBus: EventBus,
    private readonly featureFlags: FeatureFlagService,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterTransitionBlockService.name);
  }

  async post(event: DomainEvent<LetterStageChangedPayload>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('chat'))) return;
    const payload = event.payload;
    // Блок — только для осмысленного перехода с причиной (закрытие без
    // регистрации, отмена регистрации); регистрация причины не несёт.
    if (!payload.recordId || !event.actorId || !payload.comment) return;
    if (!payload.transitionName || !payload.fromStageName) return;
    const conversationId = await this.letterChat.sync(payload.letterId, event.actorId);
    if (!conversationId) return;
    const color = await this.stageColor(payload.toStageId);
    await this.txRunner.run((tx) =>
      this.write(tx, conversationId, event, payload, event.actorId!, color),
    );
  }

  private async stageColor(stageId: string): Promise<StageColor> {
    const stages = await this.catalog.stagesByIds([stageId]);
    return (stages[0]?.color as StageColor | undefined) ?? 'neutral';
  }

  private async write(
    tx: TransactionClient,
    conversationId: string,
    event: DomainEvent<LetterStageChangedPayload>,
    payload: LetterStageChangedPayload,
    actorId: string,
    color: StageColor,
  ): Promise<void> {
    // Тот же предохранитель, что у блока задачи (#741): не-участник беседы
    // письма не пишет в чужую переписку; запись журнала перехода остаётся.
    const members = await this.conversations.listMembers([conversationId], tx);
    if (!members.some((member) => member.userId === actorId)) {
      this.logger.warn(
        { letterId: payload.letterId, actorId },
        'chat: блок перехода письма не записан — актор вне беседы',
      );
      return;
    }
    const seq = await this.writes.allocateSeqs(conversationId, 1, tx);
    const inserted = await this.writes.insertMessage(
      {
        id: randomUUID(),
        conversationId,
        seq,
        authorId: actorId,
        clientMessageId: `letter-transition:${event.id}`,
        text: payload.comment ?? '',
        kind: 'letter_transition',
        payload: {
          kind: 'letter_transition',
          letterId: payload.letterId,
          recordId: payload.recordId,
          transitionName: payload.transitionName,
          fromStageName: payload.fromStageName,
          toStageName: payload.toStageName.slice(0, 40),
          toStageColor: color,
          commentLabel: payload.commentLabel ?? null,
        },
        replyToId: null,
        replySnapshot: null,
        threadRootId: null,
        fwd: null,
        urgent: false,
        mentionedUserIds: [],
        everMentionedUserIds: [],
        createdAt: new Date(),
      },
      tx,
    );
    if (!inserted) return; // повтор доставки: блок уже в ленте
    await this.vault.applyMessageSent(tx, inserted, [], inserted.text);
    await this.writes.touchLastMessageAt(conversationId, tx);
    await this.memberships.revealHidden(conversationId, tx);
    const message = await this.mapper.toFreshDto(inserted, {
      viewerId: actorId,
      members,
      replyOriginal: null,
      attachments: [],
      tx,
    });
    await this.eventBus.emit(
      tx,
      CHAT_EVENTS.MESSAGE_SENT,
      {
        conversationId,
        messageId: inserted.id,
        seq: Number(inserted.seq),
        authorId: actorId,
        threadRootId: null,
        forwarded: false,
        urgent: false,
        mentionedUserIds: [],
        message,
      },
      { actorId, aggregateType: 'conversation', aggregateId: conversationId },
    );
    this.logger.info(
      { letterId: payload.letterId, recordId: payload.recordId },
      'chat: блок перехода письма записан',
    );
  }
}
