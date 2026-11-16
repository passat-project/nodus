import { Injectable } from '@nestjs/common';
import { CORRESPONDENCE_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';

import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { NotificationsService } from '../notifications.service.js';

interface LetterDeletedPayload {
  letterId?: string;
}

/**
 * Подписчик `correspondence.letter_deleted` (AUD-011): удалённое письмо
 * больше не открыть — уведомления о нём («Поступило письмо», «Исходящее не
 * отправлено») удаляются у всех получателей, иначе «Требуют внимания» не
 * обнуляется, а клик ведёт в «не найдено». Канон чистки #252/#267:
 * каждому затронутому — notification.read. Идемпотентно: повтор события —
 * 0 строк, 0 эмитов.
 */
@Injectable()
export class LetterDeletedNotifyHandler implements DomainEventHandler<LetterDeletedPayload> {
  static readonly eventType = CORRESPONDENCE_EVENTS.LETTER_DELETED;

  constructor(
    private readonly service: NotificationsService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async handle(event: DomainEvent<LetterDeletedPayload>): Promise<void> {
    if (!(await this.featureFlags.isEnabled('notifications'))) return;
    const letterId = event.payload.letterId;
    if (typeof letterId !== 'string') return;
    await this.service.purgeBySource('letter', letterId);
  }
}
