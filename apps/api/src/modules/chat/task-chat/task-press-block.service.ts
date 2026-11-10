import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CHAT_EVENTS,
  TASK_EVENTS,
  type DomainEvent,
  type TaskPressReturnedPayload,
  type TaskPressSubmittedPayload,
} from '@nodus/contracts';
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

type PressEvent =
  | DomainEvent<TaskPressSubmittedPayload>
  | DomainEvent<TaskPressReturnedPayload>;

/**
 * Блок отметки сбора в чате задачи (#434). Пишется только для адресных
 * раундов: «Все сотрудники» — анти-спам, персональных блоков на весь штат
 * нет (события таких раундов приходят с `broadcast=true` и игнорируются).
 * Идемпотентность — `client_message_id` из id события: повтор доставки
 * outbox не дублирует строку. Текст — результат участника или причина
 * возврата, чтобы поиск/превью работали по тексту.
 */
@Injectable()
export class TaskPressBlockService {
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
    this.logger.setContext(TaskPressBlockService.name);
  }

  async post(event: PressEvent): Promise<void> {
    if (!(await this.featureFlags.isEnabled('chat'))) return;
    const payload = event.payload;
    if (payload.broadcast || !event.actorId) return;
    const conversationId = await this.taskChat.sync(payload.taskId, event.actorId);
    if (!conversationId) return;
    await this.txRunner.run((tx) =>
      this.write(tx, conversationId, event, event.actorId as string),
    );
  }

  private async write(
    tx: TransactionClient,
    conversationId: string,
    event: PressEvent,
    actorId: string,
  ): Promise<void> {
    const payload = event.payload;
    const submitted = event.type === TASK_EVENTS.PRESS_SUBMITTED;
    const text = payloadText(event);
    const seq = await this.writes.allocateSeqs(conversationId, 1, tx);
    const inserted = await this.writes.insertMessage(
      {
        id: randomUUID(),
        conversationId,
        seq,
        authorId: actorId,
        clientMessageId: `task-press:${event.id}`,
        text,
        kind: 'task_press',
        payload: submitted
          ? {
              kind: 'task_press',
              taskId: payload.taskId,
              transitionName: payload.transitionName,
              state: 'pressed',
              fileCount: (payload as TaskPressSubmittedPayload).result.fileCount,
              returnCount: null,
            }
          : {
              kind: 'task_press',
              taskId: payload.taskId,
              transitionName: payload.transitionName,
              state: 'returned',
              fileCount: null,
              returnCount: (payload as TaskPressReturnedPayload).userIds.length,
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
      { taskId: payload.taskId, pressState: submitted ? 'pressed' : 'returned' },
      'chat: блок отметки сбора записан',
    );
  }
}

/** Текст блока: результат участника (сдача) или причина возврата. */
function payloadText(event: PressEvent): string {
  return event.type === TASK_EVENTS.PRESS_SUBMITTED
    ? (event.payload as TaskPressSubmittedPayload).result.text.slice(0, 2000)
    : (event.payload as TaskPressReturnedPayload).reason;
}
