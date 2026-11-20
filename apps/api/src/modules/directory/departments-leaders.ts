import { DIRECTORY_EVENTS, ErrorCode, type AuthUser } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { EventBus } from '../../core/events/event-bus.js';
import type { DepartmentsRepository } from './departments.repository.js';
import type { ManagerDerivationService } from './manager-derivation.service.js';
import type { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import type { UsersRepository } from './users.repository.js';
import { transferUserToDepartment, type UserTransferDeps } from './users-transfer.js';

/** Зависимости правил руководства узла (#946/#817) — без Nest-контейнера. */
export interface LeadersDeps {
  departments: DepartmentsRepository;
  users: UsersRepository;
  managers: ManagerDerivationService;
  guard: RoleAssignmentGuard;
  eventBus: EventBus;
}

export function transferDeps(deps: LeadersDeps): UserTransferDeps {
  return {
    users: deps.users,
    departments: deps.departments,
    managers: deps.managers,
    guard: deps.guard,
    eventBus: deps.eventBus,
  };
}

/** #946/#817: назначение главы/замов переводит их в подразделение — в той же
 *  транзакции, тем же ядром, что правка карточки (одно место). */
export async function transferLeaders(
  deps: LeadersDeps,
  departmentId: string,
  headId: string | null | undefined,
  deputyIds: readonly string[],
  actor: AuthUser,
  tx: TransactionClient,
): Promise<void> {
  const userIds = [...new Set([headId ?? '', ...deputyIds])].filter(
    (userId): userId is string => typeof userId === 'string' && userId.length > 0,
  );
  for (const userId of userIds) {
    await transferUserToDepartment({ userId, departmentId, actor }, tx, transferDeps(deps));
  }
}

/** #817: один человек — глава одного подразделения. Ядро перевода снимает
 *  старую роль, только когда сотрудник реально переезжает; если он уже
 *  состоит в целевом узле, перевод — no-op, и прежний узел остался бы с ним
 *  же главой. Добираем такие узлы точечно. */
export async function clearHeadElsewhere(
  deps: LeadersDeps,
  departmentId: string | null,
  headId: string | null | undefined,
  actor: AuthUser,
  tx: TransactionClient,
): Promise<void> {
  if (!headId) return;
  const affected = (await deps.departments.clearHeadBesides(headId, departmentId, tx)) ?? [];
  if (affected.length === 0) return;
  await deps.managers.recomputeDepartments(affected, tx);
  for (const id of affected) {
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.DEPARTMENT_UPDATED,
      { departmentId: id, changedFields: ['headId'] },
      { actorId: actor.id, aggregateType: 'department', aggregateId: id },
    );
  }
}

/** #946/#817: глава не входит в список замов (400 с `details`). */
export function assertDistinctLeaders(
  headId: string | null | undefined,
  deputyIds: readonly string[],
): void {
  if (!headId) return;
  const clash = deputyIds.find((deputyId) => deputyId.toLowerCase() === headId.toLowerCase());
  if (!clash) return;
  throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Head and deputy must differ', {
    field: 'deputyIds',
    reason: 'same_as_head',
  });
}
