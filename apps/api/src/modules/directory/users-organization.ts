import type {
  ListUsersQuery,
  MyOrganization,
  Paginated,
  UserCard,
  UserListItem,
} from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import type { OrgStructureReader } from '../../core/ports/org-structure.port.js';
import type { DepartmentsRepository } from './departments.repository.js';
import { toListItem, toUserCard } from './user-dto.js';
import type { UsersRepository } from './users.repository.js';

/**
 * Чтение справочника и оргструктуры сотрудника (#919): список, «Кто я» и
 * карточка профиля. Вынесено из `users.service.ts` (I5): сценарии не меняют
 * данные и не участвуют в транзакциях — им нужны только репозитории и
 * подпись аватара.
 */

export interface OrganizationDeps {
  users: UsersRepository;
  org: OrgStructureReader;
  departments: DepartmentsRepository;
  avatarUrlOf: (fileId: string | null) => string | null;
}

/** Страница сотрудников с фильтрами: поиск, подразделение, статус. */
export async function listUsersOf(
  query: ListUsersQuery,
  deps: OrganizationDeps,
): Promise<Paginated<UserListItem>> {
  const page = await deps.users.findPage(
    { search: query.search, departmentId: query.departmentId, status: query.status },
    query.cursor,
    query.limit,
  );
  return {
    items: page.items.map((row) => toListItem(row, deps.avatarUrlOf)),
    nextCursor: page.nextCursor,
  };
}

/**
 * «Кто я»: профиль, руководитель, подразделение с путём от корня и
 * подчинённые по оргструктуре. Руководитель берётся из прямой связи или
 * главы подразделения (порт), подчинённые — из того же порта, что у
 * видимости задач.
 */
export async function myOrganizationOf(
  userId: string,
  deps: OrganizationDeps,
): Promise<MyOrganization> {
  const user = await deps.users.findListById(userId);
  if (!user) throw DomainException.notFound('User not found');
  const managerId = user.managerId ?? (await deps.org.managerChainOf(userId))[0] ?? null;
  const [manager, subordinateIds] = await Promise.all([
    managerId ? deps.users.findListById(managerId) : Promise.resolve(null),
    deps.org.subordinateIds(userId),
  ]);
  const subordinateRows = await deps.users.findListByIds(subordinateIds);
  const departmentIds = user.departmentId
    ? await deps.departments.findParentChain(user.departmentId)
    : [];
  const nameById = new Map(
    (await deps.departments.findNamesByIds(departmentIds)).map((row) => [row.id, row.name]),
  );
  // Цепочка идёт от самого подразделения вверх — путь показываем от корня.
  const path = [...departmentIds].reverse().flatMap((id) => {
    const name = nameById.get(id);
    return name ? [{ id, name }] : [];
  });
  return {
    user: toListItem(user, deps.avatarUrlOf),
    manager: manager ? toListItem(manager, deps.avatarUrlOf) : null,
    department: path.length > 0 ? { id: path.at(-1)!.id, name: path.at(-1)!.name, path } : null,
    subordinates: subordinateRows.map((row) => toListItem(row, deps.avatarUrlOf)),
    subordinatesTotal: subordinateIds.length,
  };
}

/** Карточка сотрудника; отсутствующий — 404 (как и остальные маршруты). */
export async function userCardOf(id: string, deps: OrganizationDeps): Promise<UserCard> {
  const row = await deps.users.findCardById(id);
  if (!row) throw DomainException.notFound('User not found');
  return toUserCard(row, deps.avatarUrlOf);
}
