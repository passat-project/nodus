import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHAT_EVENTS, type DomainEvent, type TaskStageChangedPayload } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { ConversationsRepository } from '../conversations/conversations.repository.js';
import { participantRoster } from '../conversations/participant-roster.js';
import { ConversationMembersRepository } from '../conversations/conversation-members.repository.js';
import { MessageDtoMapper } from '../messages/message-dto.mapper.js';
import { MessagesWriteRepository } from '../messages/messages-write.repository.js';
import { VaultWriteRepository } from '../vault/vault-write.repository.js';
import { TaskChatService } from './task-chat.service.js';

/**
 * Блок перехода задачи в чате (#380, #313-совместимо): обработчик
 * `task.stage_changed` с `recordId` и непустой причиной или итогом пишет в
 * беседу задачи сообщение `kind='task_transition'` — автор нажавший,
 * payload — данные блока, текст — причина (поиск/цитаты/превью уведомлений
 * работают по тексту). Идемпотентность — `client_message_id` из id события:
 * повторная доставка outbox не дублирует блок.
 */
@Injectable()
export class TaskTransitionBlockService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly taskChat: TaskChatService,
    private readonly writes: MessagesWriteRepository,
    private readonly mapper: MessageDtoMapper,
    private readonly conversations: ConversationsRepository,
    private readonly memberships: ConversationMembersRepository,
    private readonly vault: VaultWriteRepository,
    private readonly eventBus: EventBus,
    private readonly featureFlags: FeatureFlagService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskTransitionBlockService.name);
  }

  async post(event: DomainEvent<TaskStageChangedPayload>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('chat'))) return;
    const payload = event.payload;
    // Правило/система (actorId=null) — задел #434/#313: системные строки
    // придут своей инфраструктурой; событие без журнала — не блок.
    if (!payload.recordId || !event.actorId) return;
    if (!payload.comment && !payload.result) return;
    if (!payload.transitionName || !payload.fromStageName) return;
    // Удалённой задаче беседу не создаём (sync вернёт null).
    const conversationId = await this.taskChat.sync(payload.taskId, event.actorId);
    if (!conversationId) return;
    await this.txRunner.run((tx) => this.write(tx, conversationId, event, payload, event.actorId!));
  }

  private async write(
    tx: TransactionClient,
    conversationId: string,
    event: DomainEvent<TaskStageChangedPayload>,
    payload: TaskStageChangedPayload,
    actorId: string,
  ): Promise<void> {
    // Нажатие может прийти от того, кто видит задачу по праву, но в беседе
    // задачи не состоит (обход условий маршрута). Такому актору писать в
    // чужую переписку нельзя — блок пропускаем, запись журнала остаётся.
    const members = await participantRoster(this.conversations, conversationId, actorId, tx);
    if (!members) {
      this.logger.warn(
        { taskId: payload.taskId, actorId },
        'chat: блок перехода не записан — актор вне беседы задачи',
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
        clientMessageId: `task-transition:${event.id}`,
        text: payload.comment ?? '',
        kind: 'task_transition',
        payload: {
          kind: 'task_transition',
          taskId: payload.taskId,
          recordId: payload.recordId,
          transitionName: payload.transitionName,
          fromStageName: payload.fromStageName,
          toStageName: payload.toStageName.slice(0, 40),
          commentLabel: payload.commentLabel ?? null,
          result: payload.result
            ? {
                fileCount: payload.result.fileCount,
                messageCount: payload.result.messageCount,
              }
            : null,
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

    // Витрина #211 и активность беседы — как у обычного сообщения; упоминаний
    // нет (причина — обычный текст, без fan-out по подставленным токенам).
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
      { taskId: payload.taskId, recordId: payload.recordId },
      'chat: блок перехода задачи записан',
    );
  }
}
