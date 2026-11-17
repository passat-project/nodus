import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type UpdateMyProfileDto,
  type UserCard,
} from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import type { EventBus } from '../../core/events/event-bus.js';
import type { TransactionRunner } from '../../core/database/transaction-runner.js';
import type { RolesRepository } from './roles.repository.js';
import { toUserCard } from './user-dto.js';
import type { UsersRepository } from './users.repository.js';

/**
 * Профиль сотрудника и проверка ролей (#919): правка своих полей и
 * существование ролей. Вынесено из `users.service.ts` (I5); транзакция и
 * событие — в одной точке, как и было.
 */

export interface ProfileDeps {
  users: UsersRepository;
  tx: TransactionRunner;
  eventBus: EventBus;
  avatarUrlOf: (fileId: string | null) => string | null;
}

/** Правка своего профиля: только разрешённые поля, событие в той же tx. */
export async function updateMyProfileOf(
  userId: string,
  dto: UpdateMyProfileDto,
  deps: ProfileDeps,
): Promise<UserCard> {
  const before = await deps.users.findCardById(userId);
  if (!before) {
    throw DomainException.notFound('User not found');
  }
  return deps.tx.run(async (tx) => {
    await deps.users.update(userId, { ...dto }, tx);
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.USER_UPDATED,
      { userId, changedFields: Object.keys(dto) },
      { actorId: userId, aggregateType: 'user', aggregateId: userId },
    );
    return toUserCard((await deps.users.findCardById(userId, tx))!, deps.avatarUrlOf);
  });
}

/** Роли из тела запроса должны существовать (иначе 400 с перечнем). */
export async function assertRolesExist(
  roles: RolesRepository,
  roleIds: readonly string[],
): Promise<void> {
  if (roleIds.length === 0) return;
  const found = await roles.countByIds([...roleIds]);
  if (found !== roleIds.length) {
    throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown role ids', { roleIds });
  }
}
