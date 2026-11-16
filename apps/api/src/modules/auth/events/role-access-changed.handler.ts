import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  type DomainEvent,
  type DomainEventHandler,
  type RoleAccessChangedPayload,
} from '@nodus/contracts';

import { RevokedUsersStore } from '../revoked-users.store.js';

/**
 * Подписчик `directory.role.access_changed` (#866, AUD-002): смена состава
 * роли или её набора прав обесценивает ранее выданные access-токены всех
 * затронутых пользователей — следующий запрос идёт с правами из БД (клиент
 * прозрачно обновляет токен через refresh). Момент — `createdAt` события;
 * повтор доставки идемпотентен: запись стоп-листа только вперёд.
 */
@Injectable()
export class RoleAccessChangedHandler implements DomainEventHandler<RoleAccessChangedPayload> {
  static readonly eventType = DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED;

  constructor(private readonly revokedUsers: RevokedUsersStore) {}

  async handle(event: DomainEvent<RoleAccessChangedPayload>): Promise<void> {
    const at = new Date(event.createdAt);
    for (const userId of new Set(event.payload?.userIds ?? [])) {
      if (!userId) continue;
      await this.revokedUsers.revoke(userId, at);
    }
  }
}
