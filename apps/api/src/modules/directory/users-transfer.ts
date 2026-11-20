import { DIRECTORY_EVENTS, type AuthUser } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import type { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import type { UsersRepository } from './users.repository.js';
import {
  clearLeadershipInDepartment,
  emitAccessChanged,
  type DeactivationDeps,
} from './users-deactivation.js';

/**
 * Перевод сотрудника в подразделение (#923, #946): единственное транзакционное
 * ядро — вынесено из `users.service.ts` (I5), чтобы правка карточки и назначение
 * главы/зама в окне подразделения переводили одинаково, без вложенной
 * транзакции. Вызывается в транзакции вызывающего.
 *
 * Порядок: снимок действующих ролей «до» → снятие руководящей роли старого узла
 * (замки `departments → users`) → запись подразделения → пересчёт производного
 * руководителя (ADR-0053) → bind (#490) → отзыв access-токенов (#866) →
 * `directory.user.updated`. «То же подразделение» — no-op: ни записей, ни событий.
 */

export interface UserTransferDeps extends DeactivationDeps {
  users: UsersRepository;
  guard: RoleAssignmentGuard;
}

export interface UserTransferInput {
  userId: string;
  departmentId: string | null;
  actor: AuthUser;
  /** `changedFields` события `user.updated`: у правки карточки — все поля запроса. */
  changedFields?: string[];
  /** false — событие `user.updated` эмитит вызывающий (одно на запрос). */
  emitUserUpdated?: boolean;
}

export async function transferUserToDepartment(
  input: UserTransferInput,
  tx: TransactionClient,
  deps: UserTransferDeps,
): Promise<boolean> {
  const { userId, departmentId, actor } = input;
  const previousDepartmentId = await deps.users.findDepartmentId(userId, tx);
  // UUID в PostgreSQL регистронезависим, а zod пропускает верхний регистр:
  // без сравнения без учёта регистра «тот же отдел» выглядел бы переводом.
  const sameDepartment =
    departmentId === null
      ? previousDepartmentId === null
      : previousDepartmentId !== null &&
        departmentId.toLowerCase() === previousDepartmentId.toLowerCase();
  if (sameDepartment) return false;

  const beforeRoleIds = await deps.guard.effectiveRoleIds(userId, tx);
  // Роль главы/зама живёт в СВОЁМ подразделении: сотрудник ушёл — узел её
  // теряет, подчинённые переезжают к ближайшему главе выше. Снимаем ДО записи
  // сотрудника — общая дисциплина замков `departments → users` (встречный
  // порядок давал дедлок с правкой/переносом подразделения, #923).
  if (previousDepartmentId !== null) {
    await clearLeadershipInDepartment(previousDepartmentId, userId, actor.id, tx, deps);
  }
  await deps.users.update(userId, { departmentId }, tx);
  // #923: смена подразделения меняет ближайшего главу — пересчитываем
  // производного руководителя в той же транзакции (ADR-0053).
  await deps.managers.recomputeUsers([userId], tx);
  // bind (#490): роли, добавленные подразделением, — только из прав актора.
  await deps.guard.assertEffectiveRolesHeld(actor, userId, beforeRoleIds, tx);
  // #866/AUD-002: действующий набор ролей изменился — access-токены обесцениваются.
  await emitAccessChanged(tx, userId, beforeRoleIds, actor.id, deps);
  if (input.emitUserUpdated !== false) {
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.USER_UPDATED,
      { userId, changedFields: input.changedFields ?? ['departmentId'] },
      { actorId: actor.id, aggregateType: 'user', aggregateId: userId },
    );
  }
  return true;
}
