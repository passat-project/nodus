import {
  DIRECTORY_EVENTS,
  ErrorCode,
  SystemRole,
  type AuthUser,
  type UserCard,
} from '@nodus/contracts';

import type { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { EventBus } from '../../core/events/event-bus.js';
import type { DepartmentsRepository } from './departments.repository.js';
import type { ManagerDerivationService } from './manager-derivation.service.js';
import type { RolesRepository } from './roles.repository.js';
import { toUserCard } from './user-dto.js';
import type { UserCardRow, UsersRepository } from './users.repository.js';
import { clearLeadershipOf } from './users-deactivation.js';

/**
 * Жизненный цикл сотрудника — увольнение и возврат (#923): вынесено из
 * `users.service.ts` (I5). Защита последнего администратора (#490) — под
 * замком строки роли; увольнение снимает главу/зама и пересчитывает
 * производных руководителей; себя уволить нельзя (I8).
 */

/** Прямая роль «Администратор» сотрудника, если есть (замок и последний админ). */
export function adminRoleOf(row: Pick<UserCardRow, 'roles'>): { id: string; code: string } | null {
  const match = row.roles.find((assignment) => assignment.role.code === SystemRole.ADMIN);
  return match ? { id: match.role.id, code: match.role.code } : null;
}

export interface LifecycleDeps {
  users: UsersRepository;
  roles: RolesRepository;
  tx: TransactionRunner;
  eventBus: EventBus;
  departments: DepartmentsRepository;
  managers: ManagerDerivationService;
  avatarUrlOf: (fileId: string | null) => string | null;
}

/** Деактивация (увольнение): статус + события; сессии отзовёт подписчик auth. */
export async function deactivateUserOf(
  id: string,
  actor: AuthUser,
  deps: LifecycleDeps,
): Promise<UserCard> {
  // UUID канонически в нижнем регистре (ParseUUIDPipe пропускает верхний):
  // иначе сравнение «себя» и события/ключи стоп-листа расходятся с `sub`.
  const targetId = id.toLowerCase();
  // #923: себя уволить нельзя — правило бизнес-логики, а не только скрытая
  // кнопка (I8: сервер обязан отказать).
  if (targetId === actor.id.toLowerCase()) {
    throw new DomainException(ErrorCode.DIRECTORY_SELF_DEACTIVATE, 'Cannot deactivate yourself');
  }
  const before = await deps.users.findCardById(targetId);
  if (!before) {
    throw DomainException.notFound('User not found');
  }
  if (before.status === 'invited') {
    // Приглашённый не активирован: «Уволить» нечего, приглашение отменяет
    // отдельное действие (#101); старый deactivate не должен его трогать.
    throw new DomainException(ErrorCode.CONFLICT, 'Invited user cannot be deactivated');
  }
  if (before.status === 'deactivated') {
    return toUserCard(before, deps.avatarUrlOf); // идемпотентно
  }

  return deps.tx.run(async (tx) => {
    // #946: деактивация снимает главу/зама во всех узлах — сериализуется с
    // назначением/переводом (advisory-лок дерева) и берётся ДО замка роли
    // admin: обратный порядок давал инверсию с bind-проверкой правки узла.
    await deps.departments.lockTree(tx);
    // Замок строки admin (#490): деактивация последнего администратора
    // сериализуется с правками состава роли; состав читается под замком.
    let adminRoleId: string | null = null;
    const lockedId = await deps.roles.lockByCodeForUpdate(SystemRole.ADMIN, tx);
    if (lockedId !== null) {
      const current = (await deps.users.findCardById(targetId, tx))!;
      if (adminRoleOf(current) !== null) {
        adminRoleId = lockedId;
      }
    }
    // #923: уволенный не может оставаться главой/замом — ссылки снимаются,
    // подчинённые переезжают к ближайшему главе выше (события — там же).
    // Снимаем ДО записи статуса: общая дисциплина замков `departments → users`,
    // как в переводе и DepartmentsService (обратный порядок давал дедлок с
    // правкой/переносом подразделения).
    await clearLeadershipOf(targetId, actor.id, tx, deps);
    await deps.users.update(targetId, { status: 'deactivated' }, tx);
    if (
      adminRoleId !== null &&
      (await deps.roles.countActiveDirectMembers(adminRoleId, tx)) === 0
    ) {
      throw new DomainException(ErrorCode.ROLE_LAST_ADMIN, 'Last administrator', {
        roleId: adminRoleId,
      });
    }
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.USER_DEACTIVATED,
      { userId: targetId },
      { actorId: actor.id, aggregateType: 'user', aggregateId: targetId },
    );
    return toUserCard((await deps.users.findCardById(targetId, tx))!, deps.avatarUrlOf);
  });
}

/** Возврат в работу (AUD-016): снятие деактивации + парное событие. Сессии
 *  не восстанавливаются — вход заново; роли и история сохраняются. */
export async function activateUserOf(
  id: string,
  actor: AuthUser,
  deps: LifecycleDeps,
): Promise<UserCard> {
  const targetId = id.toLowerCase();
  const before = await deps.users.findCardById(targetId);
  if (!before) throw DomainException.notFound('User not found');
  if (before.status === 'invited') {
    // Активирует только принятие приглашения (пароль задаёт сам сотрудник);
    // «Вернуть в работу» до активации включил бы вход без пароля/ссылки.
    throw new DomainException(ErrorCode.CONFLICT, 'Invited user cannot be activated directly');
  }
  if (before.status === 'active') return toUserCard(before, deps.avatarUrlOf); // идемпотентно

  return deps.tx.run(async (tx) => {
    await deps.users.update(targetId, { status: 'active' }, tx);
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.USER_ACTIVATED,
      { userId: targetId },
      { actorId: actor.id, aggregateType: 'user', aggregateId: targetId },
    );
    return toUserCard((await deps.users.findCardById(targetId, tx))!, deps.avatarUrlOf);
  });
}
