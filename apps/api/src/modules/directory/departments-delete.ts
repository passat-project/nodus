import { DIRECTORY_EVENTS, ErrorCode, type AuthUser } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { EventBus } from '../../core/events/event-bus.js';
import type { DepartmentsRepository } from './departments.repository.js';
import type { ManagerDerivationService } from './manager-derivation.service.js';
import type { RoleAudienceRepository } from './role-audience.repository.js';
import type { UsersRepository } from './users.repository.js';

/** Зависимости удаления подразделения (#881) — без Nest-инъекции, чтобы
 *  сервис оставался ≤ 300 строк (I5), а транзакция — у вызывающего. */
export interface DepartmentDeleteDeps {
  departments: DepartmentsRepository;
  users: UsersRepository;
  audience: RoleAudienceRepository;
  managers: ManagerDerivationService;
  eventBus: EventBus;
}

/**
 * Жёсткое удаление подразделения с переносом (#881): дети и прямые сотрудники
 * (включая уволенных) уходят к родителю; роли узла снимаются каскадом,
 * активным сотрудникам поддерева отзываются access-токены. Главная карточка
 * (единственный management-корень) и legal-узлы не удаляются. Вызывается в
 * транзакции сервиса под advisory-локом дерева.
 */
export async function deleteDepartmentWithTransfer(
  id: string,
  actor: AuthUser,
  tx: TransactionClient,
  deps: DepartmentDeleteDeps,
): Promise<void> {
  if (!(await deps.departments.lockForUpdate(id, tx))) {
    throw DomainException.notFound('Department not found');
  }
  const node = await deps.departments.findById(id, tx);
  if (!node) {
    throw DomainException.notFound('Department not found');
  }
  if (node.kind === 'legal') {
    throw new DomainException(
      ErrorCode.DIRECTORY_DEPARTMENT_LEGAL_FORBIDDEN,
      'Legal department cannot be deleted',
      { id },
    );
  }
  // Главная карточка компании — единственный management-корень (#982).
  // Второй корень — аномалия данных: удаление отклоняем, а не плодим корни.
  if (node.parentId === null) {
    throw new DomainException(
      ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      'Management department root cannot be deleted',
      { id, reason: 'root' },
    );
  }
  const parentId = node.parentId;
  // Снимки ДО мутаций: роли и активная аудитория поддерева нужны для отзыва
  // access-токенов, прямые сотрудники — для переезда и search.
  const childIds = await deps.departments.findDirectChildIds(id, tx);
  const userIds = await deps.users.findIdsByDepartmentId(id, tx);
  const roleIds = await deps.audience.roleIdsOfDepartments([id], tx);
  const subtreeUserIds = await deps.audience.departmentUserIds(id, tx);

  if (childIds.length > 0) {
    await deps.departments.reparentChildren(id, parentId, tx);
  }
  if (userIds.length > 0) {
    await deps.users.moveDepartment(userIds, parentId, tx);
  }
  // Роли/замы узла уходят каскадом FK; сама строка исчезает.
  await deps.departments.deleteById(id, tx);
  // Руководитель — производное поле (#923): у переехавших сотрудников и
  // поддерева детей ближайший глава мог измениться.
  if (userIds.length > 0) {
    await deps.managers.recomputeUsers(userIds, tx);
  }
  if (childIds.length > 0) {
    await deps.managers.recomputeDepartments(childIds, tx);
  }

  await deps.eventBus.emit(
    tx,
    DIRECTORY_EVENTS.DEPARTMENT_DELETED,
    { departmentId: id, name: node.name, parentId, childDepartmentIds: childIds, userIds },
    { actorId: actor.id, aggregateType: 'department', aggregateId: id },
  );
  if (subtreeUserIds.length === 0) return;
  for (const roleId of roleIds) {
    await deps.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED,
      { roleId, reason: 'membership', userIds: [...subtreeUserIds] },
      { actorId: actor.id, aggregateType: 'role', aggregateId: roleId },
    );
  }
}
