import { Injectable } from '@nestjs/common';
import { DIRECTORY_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';

import { RevokedUsersStore } from '../revoked-users.store.js';

interface UserUpdatedPayload {
  userId: string;
  changedFields?: string[];
}

/** Поля карточки сотрудника, меняющие его действующие роли: прямой набор
 *  ролей и подразделение (от него действуют роли подразделения и предков). */
const ACCESS_CHANGING_FIELDS = new Set(['roleIds', 'departmentId']);

/**
 * Подписчик `directory.user.updated` (#866, AUD-002): смена ролей или
 * подразделения сотрудника карточкой меняет права, зашитые в его access-токен,
 * — токен обесценивается (момент — `createdAt` события). Прочие правки профиля
 * (имя, контакты, аватар) токены не трогают. Повтор доставки идемпотентен:
 * стоп-лист пишется только вперёд.
 */
@Injectable()
export class UserRolesChangedHandler implements DomainEventHandler<UserUpdatedPayload> {
  static readonly eventType = DIRECTORY_EVENTS.USER_UPDATED;

  constructor(private readonly revokedUsers: RevokedUsersStore) {}

  async handle(event: DomainEvent<UserUpdatedPayload>): Promise<void> {
    const { userId, changedFields } = event.payload ?? {};
    if (!userId || !changedFields?.some((field) => ACCESS_CHANGING_FIELDS.has(field))) return;
    await this.revokedUsers.revoke(userId, new Date(event.createdAt));
  }
}
