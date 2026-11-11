import { Inject, Injectable } from '@nestjs/common';
import type {
  ListNotificationsQuery,
  Notification,
  NotificationDelivery,
  NotificationPage,
  NotificationSettings,
  NotificationSummary,
} from '@nodus/contracts';
import { NOTIFICATION_EVENTS } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { ErrorCode } from '@nodus/contracts';
import { EventBus } from '../../core/events/event-bus.js';
import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  CHAT_MEMBERSHIP_READER,
  type ChatConversationState,
  type ChatMembershipReader,
} from '../chat/membership-reader.port.js';
import {
  buildInsertsFromEditedEvent,
  buildInsertsFromMessageEvent,
  type MessageEditedInsertEvent,
  type MessageSentInsertEvent,
} from './notification-builders.js';
import { NotificationsRepository, type NotificationInsert } from './notifications.repository.js';

const CURSOR_PATTERN = /^[0-9]+$/;

/** Настройки по умолчанию (DND выключен; окно сохраняется на будущее). */
const DEFAULT_SETTINGS: NotificationSettings = {
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '08:00',
};

/**
 * Бизнес-логика журнала уведомлений (ADR-0016): лента/сводка, ознакомление,
 * «ознакомились N из M», настройки, гашение по источнику. Создание строк —
 * events/message-sent.handler (конвейер событий); HTTP сервис не знает.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
    @Inject(CHAT_MEMBERSHIP_READER) private readonly chatMembership: ChatMembershipReader,
  ) {}

  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationPage> {
    if (query.cursor !== undefined && !CURSOR_PATTERN.test(query.cursor)) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
    }
    const { rows, hasMore } = await this.repo.list(userId, query);
    const items = await this.repo.toDtos(rows);
    return {
      items,
      nextCursor: hasMore && rows.length > 0 ? String(rows[rows.length - 1]!.seq) : null,
      lastSeq: rows.length > 0 ? Number(rows[0]!.seq) : 0,
    };
  }

  async summary(userId: string): Promise<NotificationSummary> {
    const counts = await this.repo.summary(userId);
    return { ...counts, attention: counts.urgent + counts.high + counts.medium };
  }

  /** Прочитать одно (E3 — осознанное гашение из карточки): любое, включая
   *  важное — ack-механики нет (ревизия модели 05.10), повторы гасит
   *  прочтение (repo.readOne + markReadBySource). Реальный переход в read
   *  эмитит notification.read — другие устройства владельца синхронят бейдж
   *  (D2); повторное чтение прочитанного — тишина (#267). */
  async readOne(userId: string, id: string): Promise<Notification> {
    const row = await this.txRunner.run(async (tx) => {
      const read = await this.repo.readOne(userId, id, tx);
      if (!read) return null;
      if (read.changed) {
        await this.emitRead(tx, userId, read.row.source_id, [read.row.id]);
      }
      return read.row;
    });
    if (!row) throw DomainException.notFound('Notification not found');
    const [dto] = await this.repo.toDtos([row]);
    return dto!;
  }

  /** Журнал доставок (D6: когда и каким каналом уведомили). */
  async deliveries(userId: string, id: string): Promise<NotificationDelivery[]> {
    const row = await this.repo.findById(userId, id);
    if (!row) throw DomainException.notFound('Notification not found');
    return this.repo.deliveries(id);
  }

  async settings(userId: string): Promise<NotificationSettings> {
    return (await this.repo.readSettings(userId)) ?? DEFAULT_SETTINGS;
  }

  async updateSettings(
    userId: string,
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    return this.repo.upsertSettings(userId, patch);
  }

  /** Гашение по источнику (обработчик chat.message_read): журнал + будило.
   *  Повторы гасятся только до watermark'а (#770): прочтение старого не
   *  останавливает срочные повторы более нового непрочитанного. */
  async markReadBySource(userId: string, sourceId: string, upToSeq: number): Promise<number> {
    return this.txRunner.run(async (tx) => {
      const read = await this.repo.markReadBySource(userId, sourceId, upToSeq, tx);
      await this.repo.stopRepeats(userId, { conversationId: sourceId, upToSeq }, tx);
      if (read > 0) {
        await this.emitRead(tx, userId, sourceId, null);
      }
      return read;
    });
  }

  /** Открыта карточка сущности (#252): все её уведомления у пользователя
   *  прочитаны — «Требуют внимания» не висят вечно. Идемпотентно. */
  async readBySource(userId: string, sourceType: string, sourceId: string): Promise<number> {
    return this.txRunner.run(async (tx) => {
      const read = await this.repo.readByEntity(userId, sourceType, sourceId, tx);
      if (read > 0) await this.emitRead(tx, userId, sourceId, null);
      return read;
    });
  }

  /** Стоп повторов по реакции получателя (C3, обработчик chat.reaction_added). */
  async stopRepeatsByReaction(userId: string, messageId: string): Promise<void> {
    await this.repo.stopRepeats(userId, { messageId });
  }

  /** Чистка по удалённому сообщению (#267, обработчик chat.message_deleted):
   *  удалённое до прочтения сообщение физически не прочитывается
   *  (obliterated-строки нет во вьюпорте — watermark не накроет source_seq),
   *  строки журнала об этом сообщении удаляются у всех получателей; каждому
   *  затронутому — notification.read (бейдж/лента — штатный конвейер, как при
   *  гашении прочтением). Идемпотентно: 0 строк — 0 эмитов. */
  async purgeByMessage(conversationId: string, messageId: string): Promise<number> {
    return this.txRunner.run(async (tx) => {
      // Дедуп: у одного пользователя может быть несколько строк на сообщение
      // (sent + edited) — notification.read достаточно один на пользователя.
      const affected = [...new Set(await this.repo.deleteByMessage(messageId, tx))];
      for (const userId of affected) {
        await this.emitRead(tx, userId, conversationId, null);
      }
      return affected.length;
    });
  }

  /** Чистка по удалённой задаче (#252, обработчик task.deleted): строки
   *  журнала удаляются у всех, каждому затронутому — notification.read
   *  (бейдж/лента/тосты синхронизируются штатным конвейером). Идемпотентно. */
  async purgeBySource(sourceType: string, sourceId: string): Promise<number> {
    return this.txRunner.run(async (tx) => {
      const affected = [...new Set(await this.repo.deleteBySource(sourceType, sourceId, tx))];
      for (const userId of affected) {
        await this.emitRead(tx, userId, sourceId, null);
      }
      return affected.length;
    });
  }

  /** Чистка по потере участия (#311, обработчик снятия с задачи): только
   *  у перечисленных пользователей; каждому затронутому — notification.read. */
  async purgeBySourceForUsers(
    sourceType: string,
    sourceId: string,
    userIds: string[],
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    return this.txRunner.run(async (tx) => {
      const affected = [
        ...new Set(await this.repo.deleteBySourceForUsers(sourceType, sourceId, userIds, tx)),
      ];
      for (const userId of affected) {
        await this.emitRead(tx, userId, sourceId, null);
      }
      return affected.length;
    });
  }

  private async emitRead(
    tx: TransactionClient,
    userId: string,
    sourceId: string | null,
    notificationIds: string[] | null,
  ): Promise<void> {
    await this.eventBus.emit(
      tx,
      NOTIFICATION_EVENTS.READ,
      { userId, sourceId, notificationIds, readAt: new Date().toISOString() },
      { actorId: userId, aggregateType: 'notification', aggregateId: userId },
    );
  }

  /** Сборка строк журнала из события message_sent — тонкая обёртка над
   *  чистым сборщиком (`notification-builders.ts`): шов мокирования для
   *  хендлеров, как и обёртки порта чата ниже. */
  buildInsertsFromMessageEvent(
    event: MessageSentInsertEvent,
    state: ChatConversationState,
    threadWatcherIds: string[],
  ): NotificationInsert[] {
    return buildInsertsFromMessageEvent(event, state, threadWatcherIds);
  }

  /** Сборка строк журнала из события message_edited (правила первого тэга —
   *  в `notification-builders.ts`). */
  buildInsertsFromEditedEvent(
    event: MessageEditedInsertEvent,
    state: ChatConversationState,
  ): NotificationInsert[] {
    return buildInsertsFromEditedEvent(event, state);
  }

  /** Обёртки порта чата для хендлеров (мокируются в тестах). */
  async conversationState(conversationId: string) {
    return this.chatMembership.conversationState(conversationId);
  }

  async threadWatcherIds(threadRootId: string) {
    return this.chatMembership.threadWatcherIds(threadRootId);
  }

  /** Имя актора для снапшота будила (правка: события без DTO автора). */
  async actorName(userId: string): Promise<string | null> {
    const [ref] = await this.userProfiles.findRefs([userId]);
    return ref?.displayName ?? null;
  }
}
