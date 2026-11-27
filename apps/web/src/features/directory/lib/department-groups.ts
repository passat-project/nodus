import type { DepartmentNode, UserListItem } from '@nodus/contracts';

/**
 * Группы правой панели отдела (#768, вердикт владельца 12.11.2026):
 * «Руководители» (руководитель + все заместители; с #946 назначение переводит
 * их в подразделение, поэтому они его члены) и «Подчинённые» (все остальные
 * активные члены). В главной
 * карточке компании в «Подчинённые» дополнительно входят сотрудники без
 * управленческого отдела и с архивным — отображение, данные не
 * переписываются. Секции по `managerId` в панели больше нет.
 * В структуре видны только активные сотрудники.
 */
export interface StructurePanelGroups {
  heads: UserListItem[];
  subordinates: UserListItem[];
}

export function structurePanelGroups(
  node: DepartmentNode,
  users: readonly UserListItem[],
  opts: {
    /** Первый корень дерева — главная карточка компании. */
    mainCard: boolean;
    /** Id активных отделов: остальные ссылки считаются архивными. */
    activeDepartmentIds: ReadonlySet<string>;
    /** Живой поиск панели: ФИО или должность. */
    query?: string;
  },
): StructurePanelGroups {
  const active = users.filter((user) => user.status === 'active');
  const head = node.headId !== null ? active.find((user) => user.id === node.headId) : undefined;
  // Заместителей несколько (#817): все — в группе «Руководители».
  const deputies = node.deputyIds
    .map((deputyId) => active.find((user) => user.id === deputyId))
    .filter((user): user is UserListItem => user !== undefined);
  const heads = [head, ...deputies].filter(
    (user, index, list): user is UserListItem =>
      user !== undefined && list.findIndex((other) => other?.id === user.id) === index,
  );
  const headIds = new Set(heads.map((user) => user.id));

  const members = active.filter((user) => user.departmentId === node.id);
  const orphans = opts.mainCard
    ? active.filter(
        (user) => !user.departmentId || !opts.activeDepartmentIds.has(user.departmentId),
      )
    : [];

  const seen = new Set<string>();
  const subordinates = [...members, ...orphans].filter((user) => {
    if (headIds.has(user.id) || seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });

  const q = opts.query?.trim().toLowerCase();
  const matches = (user: UserListItem) =>
    !q ||
    user.displayName.toLowerCase().includes(q) ||
    (user.positionName ?? '').toLowerCase().includes(q);

  return { heads: heads.filter(matches), subordinates: subordinates.filter(matches) };
}
