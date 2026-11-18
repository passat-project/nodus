import type { UserListItem } from '@nodus/contracts';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';

/**
 * Строки «Подчинённых» карточки профиля (#923): заместители подразделений,
 * которыми руководит сотрудник (`headId === userId`), — ПЕРВЫМИ, затем прямые
 * подчинённые по `managerId`. Зам — роль в своём подразделении, а не второе
 * место в дереве: в `manager_id` он не попадает, поэтому карточка главы
 * собирает его отдельным правилом. Без дублей (зам может быть и прямым
 * подчинённым — тогда он остаётся в первой, замовой строке);
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

  const deputyIds = new Set<string>();
  for (const department of departments) {
    if (department.headId !== userId || department.deputyId === null) continue;
    const deputy = byId.get(department.deputyId);
    // Уволенный зам в подчинённых не показывается (сервер снимает ссылку при
    // увольнении; проверка — страховка от рассинхрона данных).
    if (!deputy || deputy.id === userId || deputy.status !== 'active') continue;
    deputyIds.add(deputy.id);
  }

  const list: UserListItem[] = [];
  const seen = new Set<string>();
  // Замы — первыми (вердикт приёмки 18.11.2026), порядок — как в справочнике.
  for (const user of users) {
    if (!deputyIds.has(user.id) || seen.has(user.id)) continue;
    list.push(user);
    seen.add(user.id);
  }
  for (const user of users) {
    if (user.managerId !== userId || seen.has(user.id)) continue;
    list.push(user);
    seen.add(user.id);
  }

  return { list, deputyIds };
}
