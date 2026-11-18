import { DIRECTORY_EVENTS } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import type { EventBus } from '../../core/events/event-bus.js';
import type { DepartmentsRepository } from './departments.repository.js';
import type { ManagerDerivationService } from './manager-derivation.service.js';
import type { RoleAssignmentGuard } from './role-assignment-guard.service.js';

/**
 * Побочные эффекты увольнения и смены ролей (#923), вынесенные из
 * `users.service.ts` (I5): снятие главы/зама во всех подразделениях,
 * пересчёт производных руководителей поддерева и события `department.updated`;
 * отзыв access-токенов по разнице действующих ролей (#866, AUD-002).
 */

export interface DeactivationDeps {
  departments: DepartmentsRepository;
  managers: ManagerDerivationService;
  eventBus: EventBus;
}

/** Уволенный не может оставаться главой/замом: ссылки снимаются во всех
 *  подразделениях, подчинённые переезжают к ближайшему главе выше. */
export async function clearLeadershipOf(
  userId: string,
  actorId: string,
  tx: TransactionClient,
  deps: DeactivationDeps,
): Promise<void> {
  const cleared = await deps.departments.clearHeadAndDeputy(userId, tx);
  await deps.managers.recomputeDepartments(
    cleared.map((department) => department.id),
    tx,
  );
  for (const department of cleared) {
    const changedFields = [
      ...(department.head ? ['headId'] : []),
      ...(department.deputy ? ['deputyId'] : []),
    ];
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.DEPARTMENT_UPDATED,
      { departmentId: department.id, changedFields },
      { actorId, aggregateType: 'department', aggregateId: department.id },
    );
  }
}

/** Перевод сотрудника в другое подразделение (#923): руководящая роль живёт
 *  в СВОЁМ подразделении. Сотрудник ушёл — узел теряет главу/зама, подчинённые
 *  переезжают к ближайшему главе выше (`managerId` пересчитывается), узел
 *  сообщает об изменении событием. Снимаем только старый отдел: роль в других
 *  узлах (аномалия старых данных) не трогаем — это дело увольнения. */
export async function clearLeadershipInDepartment(
  departmentId: string,
  userId: string,
  actorId: string,
  tx: TransactionClient,
  deps: DeactivationDeps,
): Promise<void> {
  const cleared = await deps.departments.clearLeadershipIn(departmentId, userId, tx);
  if (cleared === null) return;
  await deps.managers.recomputeDepartments([departmentId], tx);
  const changedFields = [
    ...(cleared.head ? ['headId'] : []),
    ...(cleared.deputy ? ['deputyId'] : []),
  ];
  await deps.eventBus.emit(
    tx,
    DIRECTORY_EVENTS.DEPARTMENT_UPDATED,
    { departmentId, changedFields },
    { actorId, aggregateType: 'department', aggregateId: departmentId },
  );
}

/** `directory.role.access_changed`: после смены подразделения или явных ролей
 *  действующие права сотрудника могли измениться — auth обесценивает его
 *  access-токены. Эмитим только реально изменившиеся роли. */
export async function emitAccessChanged(
  tx: TransactionClient,
  userId: string,
  beforeRoleIds: readonly string[],
  actorId: string,
  deps: { guard: RoleAssignmentGuard; eventBus: EventBus },
): Promise<void> {
  const afterRoleIds = (await deps.guard.effectiveRoleIds(userId, tx)) ?? [];
  const before = new Set(beforeRoleIds);
  const after = new Set(afterRoleIds);
  const changed = [
    ...beforeRoleIds.filter((roleId) => !after.has(roleId)),
    ...afterRoleIds.filter((roleId) => !before.has(roleId)),
  ];
  for (const roleId of changed) {
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED,
      { roleId, reason: 'membership', userIds: [userId] },
      { actorId, aggregateType: 'role', aggregateId: roleId },
    );
  }
}
