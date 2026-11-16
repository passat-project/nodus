import { Injectable } from '@nestjs/common';
import { CHAT_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';

import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { NotificationsService } from '../notifications.service.js';

interface MemberRemovedPayload {
  conversationId?: string;
  userId?: string;
}

/**
 * Подписчик `chat.member_removed` (AUD-011): исключённый из беседы её больше
 * не видит (404), а уведомления о ней висели бы вечно и вели в пустоту —
 * класс бага #252/#267/#311. Убираем у исключённого уведомления беседы
 * (`source_type = conversation`), у оставшихся участников они не трогаются;
 * каждому затронутому — notification.read (бейдж/лента синхронизируются
 * штатным конвейером). Событие приходит и при синхронизации состава чата
 * задачи/письма/канала проекта — обработчик идемпотентен.
 */
@Injectable()
export class ChatMemberRemovedNotifyHandler implements DomainEventHandler<MemberRemovedPayload> {
  static readonly eventType = CHAT_EVENTS.MEMBER_REMOVED;

  constructor(
    private readonly service: NotificationsService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async handle(event: DomainEvent<MemberRemovedPayload>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('notifications'))) return;
    const { conversationId, userId } = event.payload;
    if (typeof conversationId !== 'string' || typeof userId !== 'string') return;
    await this.service.purgeBySourceForUsers('conversation', conversationId, [userId]);
  }
}
