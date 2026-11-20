import { Injectable } from '@nestjs/common';
import type { DomainEvent, DomainEventHandler } from '@nodus/contracts';
import { NOTIFICATION_EVENTS } from '@nodus/contracts';

import { EventBus } from '../../../core/events/event-bus.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { PinoLogger } from 'nestjs-pino';
import { NotificationsRepository } from '../notifications.repository.js';
import { NotificationsService } from '../notifications.service.js';

interface MessageEditedPayload {
  conversationId?: string;
  messageId?: string;
  authorId?: string;
  text?: string;
  seq?: number;
  /** Ответ треда (#974): правка уходит только наблюдателям обсуждения. */
  threadRootId?: string | null;
  /** Дифф упоминаний правки (#239): пусто у событий до #239. */
  mentionedUserIds?: string[];
  previousMentionedUserIds?: string[];
  previousMentionedAll?: boolean;
  directMentionedUserIds?: string[];
}

/**
 * Подписчик `chat.message_edited` (#189: правка прилетает в центр — счётчик
 * в чате меняется, журнал показывает то же): всем членам беседы кроме
 * редактора, приоритет из таблицы KIND_PRIORITY. Идемпотентность — дедуп
 * (event_id, user_id); payload
 * старой формы (без authorId, до #189) пропускается с журналом — событие
 * помечается опубликованным, ретраев не требуется.
 */
@Injectable()
export class MessageEditedHandler implements DomainEventHandler<MessageEditedPayload> {
  static readonly eventType = 'chat.message_edited';

  constructor(
    private readonly service: NotificationsService,
    private readonly repo: NotificationsRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly featureFlags: FeatureFlagService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MessageEditedHandler.name);
  }

  async handle(event: DomainEvent<MessageEditedPayload>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('notifications'))) return;
    const payload = event.payload;
    if (!payload?.conversationId || !payload.messageId) return;
    if (!payload.authorId || payload.seq === undefined) {
      this.logger.debug({ eventId: event.id }, 'message_edited: legacy payload skipped');
      return;
    }

    const state = await this.service.conversationState(payload.conversationId);
    if (!state) return; // беседа исчезла — журналимое событие потеряло источник
    // #974: правка ответа в обсуждении — только наблюдателям треда (как у
    // отправки); правка сообщения ленты — всем членам беседы.
    const watchers = payload.threadRootId
      ? await this.service.threadWatcherIds(payload.threadRootId)
      : [];
    const inserts = this.service.buildInsertsFromEditedEvent(
      {
        id: event.id,
        payload: {
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          authorId: payload.authorId,
          text: payload.text ?? '',
          seq: payload.seq,
          threadRootId: payload.threadRootId ?? null,
          mentionedUserIds: payload.mentionedUserIds ?? [],
          previousMentionedUserIds: payload.previousMentionedUserIds ?? [],
          previousMentionedAll: payload.previousMentionedAll ?? false,
          directMentionedUserIds: payload.directMentionedUserIds ?? [],
        },
      },
      state,
      watchers,
    );
    if (inserts.length === 0) return;
    const actorName = await this.service.actorName(payload.authorId);

    await this.txRunner.run(async (tx) => {
      const created = await this.repo.createFromEvent(inserts, tx);
      for (const row of created) {
        await this.eventBus.emit(
          tx,
          NOTIFICATION_EVENTS.DISPATCH_REQUESTED,
          {
            snapshot: {
              notificationId: row.id,
              userId: row.user_id,
              priority: row.priority,
              kind: row.kind,
              sourceId: row.source_id,
              conversationId: row.conversation_id,
              conversationTitle: row.conversation_title,
              messageId: row.message_id,
              threadRootId: row.thread_root_id,
              preview: row.preview,
              actorName,
            },
            attempt: 0,
            seq: Number(row.seq),
          },
          { actorId: payload.authorId, aggregateType: 'notification', aggregateId: row.id },
        );
      }
      if (created.length === 0) {
        this.logger.debug({ eventId: event.id }, 'message_edited: all duplicates skipped');
      }
    });
  }
}
