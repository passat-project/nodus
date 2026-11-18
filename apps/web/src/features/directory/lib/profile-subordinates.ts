import type { UserListItem } from '@nodus/contracts';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';

/**
 * Строки «Подчинённых» карточки профиля (#923): прямые подчинённые по
 * `managerId` + заместители подразделений, которыми руководит сотрудник
 * (`headId === userId`). Зам — роль в своём подразделении, а не второе место в
 * дереве: в `manager_id` он не попадает, поэтому карточка главы собирает его
 * отдельным правилом. Без дублей (зам может быть и прямым подчинённым);
 * `deputyIds` — кому рисовать метку «заместитель».
 *
 * Серверная видимость задач и «Кто я» живут на собственных правилах (#939) —
 * этот helper только про отображение строк карточки.
 */
export function profileSubordinates(args: {
  userId: string;
  users: readonly UserListItem[];
  departments: readonly DepartmentOption[];
}): { list: UserListItem[]; deputyIds: ReadonlySet<string> } {
  const { userId, users, departments } = args;
  const byId = new Map(users.map((user) => [user.id, user]));
  const list: UserListItem[] = [];
  const seen = new Set<string>();

  for (const user of users) {
    if (user.managerId !== userId) continue;
    list.push(user);
    seen.add(user.id);
  }

  const deputyIds = new Set<string>();
  for (const department of departments) {
    if (department.headId !== userId || department.deputyId === null) continue;
    const deputy = byId.get(department.deputyId);
    // Уволенный зам в подчинённых не показывается (сервер снимает ссылку при
    // увольнении; проверка — страховка от рассинхрона данных).
    if (!deputy || deputy.id === userId || deputy.status !== 'active') continue;
    deputyIds.add(deputy.id);
    if (seen.has(deputy.id)) continue;
    seen.add(deputy.id);
    list.push(deputy);
  }

  return { list, deputyIds };
}
