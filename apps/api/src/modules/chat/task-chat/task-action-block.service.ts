import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHAT_EVENTS, type DomainEvent, type TaskActionPressedPayload } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { ConversationsRepository } from '../conversations/conversations.repository.js';
import { ConversationMembersRepository } from '../conversations/conversation-members.repository.js';
import { MessageDtoMapper } from '../messages/message-dto.mapper.js';
import { MessagesWriteRepository } from '../messages/messages-write.repository.js';
import { VaultWriteRepository } from '../vault/vault-write.repository.js';
import { TaskChatService } from './task-chat.service.js';

/**
 * Блок действия в чате задачи (#633): обработчик `task.action_pressed` пишет
 * сообщение `kind='task_action'` — иначе нажатие без смены статуса в ленте не
 * видно. Автор — нажавший, текст — комментарий окна. Идемпотентность —
 * `client_message_id` из id события (повтор outbox не двоит строку).
 *
 * Отдельный сервис, а не ветка перехода: у действия нет целевой стадии, и
 * правила «блок только с причиной/итогом» здесь не годятся — блок есть
 * всегда, в нём и есть весь смысл записи.
 */
@Injectable()
export class TaskActionBlockService {
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
    this.logger.setContext(TaskActionBlockService.name);
  }

  async post(event: DomainEvent<TaskActionPressedPayload>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('chat'))) return;
    const payload = event.payload;
    if (!event.actorId) return;
    const conversationId = await this.taskChat.sync(payload.taskId, event.actorId);
    if (!conversationId) return;
    await this.txRunner.run((tx) => this.write(tx, conversationId, event, payload, event.actorId!));
  }

  private async write(
    tx: TransactionClient,
    conversationId: string,
    event: DomainEvent<TaskActionPressedPayload>,
    payload: TaskActionPressedPayload,
    actorId: string,
  ): Promise<void> {
    const seq = await this.writes.allocateSeqs(conversationId, 1, tx);
    const inserted = await this.writes.insertMessage(
      {
        id: randomUUID(),
        conversationId,
        seq,
        authorId: actorId,
        clientMessageId: `task-action:${event.id}`,
        text: payload.comment ?? '',
        kind: 'task_action',
        payload: {
          kind: 'task_action',
          taskId: payload.taskId,
          recordId: payload.recordId,
          actionName: payload.actionName.slice(0, 40),
          stageName: payload.stageName.slice(0, 40),
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

    await this.vault.applyMessageSent(tx, inserted, [], inserted.text);
    await this.writes.touchLastMessageAt(conversationId, tx);
    await this.memberships.revealHidden(conversationId, tx);

    const members = await this.conversations.listMembers([conversationId], tx);
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
      'chat: блок действия задачи записан',
    );
  }
}
