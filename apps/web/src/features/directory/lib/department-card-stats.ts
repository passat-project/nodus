import type { DepartmentNode, UserListItem } from '@nodus/contracts';

/**
 * Данные карточки подразделения в структуре (#768, пакет 16.11.2026):
 * руководитель (аватар, имя, должность), заместители, прямые подчинённые,
 * число в чипе команды и отделов в подчинении. Карта считается ОДИН раз на
 * странице из уже загруженного справочника (`useUsersList` — весь штат):
 * API/контракты не меняются, статусы фильтруются здесь — в структуре видны
 * только активные сотрудники.
 *
 * Чип команды: листовая карточка — подчинённые + заместители; карточка с
 * отделами — плюс все сотрудники ветки, включая руководителей подразделений.
 * Текущий руководитель в чип не входит нигде; в главной карточке в расчёт и в
 * столбец «Подчинённые» дополнительно входят сотрудники без управленческого
 * подразделения и с архивным (данные `departmentId` не переписываются).
 */
export interface DepartmentCardHead {
  id: string;
  name: string;
  positionName: string | null;
  avatarUrl: string | null;
}

export interface DepartmentCardStats {
  /** Руководитель; null — карточка покажет «Руководитель не назначен». */
  head: DepartmentCardHead | null;
  deputies: UserListItem[];
  /** Прямые подчинённые: свой отдел без руководителя и замов (в главной — «беспризорные»). */
  subordinates: UserListItem[];
  /** Число в чипе команды: подчинённые + замы + вся ветка, без руководителя. */
  teamCount: number;
  /** Отделы в подчинении — подпись футера карточки. */
  departmentCount: number;
}

export function buildDepartmentCardStats(
  roots: readonly DepartmentNode[],
  users: readonly UserListItem[],
  opts: { mainId: string | null; activeDepartmentIds: ReadonlySet<string> },
): Map<string, DepartmentCardStats> {
  const active = users.filter((user) => user.status === 'active');
  const byId = new Map(active.map((user) => [user.id, user] as const));
  const byDepartment = new Map<string, UserListItem[]>();
  for (const user of active) {
    if (!user.departmentId) continue;
    const list = byDepartment.get(user.departmentId) ?? [];
    list.push(user);
    byDepartment.set(user.departmentId, list);
  }
  // Без подразделения и с архивным — «беспризорные» главной карточки.
  const orphans = active.filter(
    (user) => !user.departmentId || !opts.activeDepartmentIds.has(user.departmentId),
  );

  const stats = new Map<string, DepartmentCardStats>();

  /** Люди всей ветки (члены, руководители и замы всех уровней) — для чипа. */
  const visit = (node: DepartmentNode, isMain: boolean): Map<string, UserListItem> => {
    const head = node.headId ? byId.get(node.headId) : undefined;
    const deputy =
      node.deputyId && node.deputyId !== node.headId ? byId.get(node.deputyId) : undefined;
    const members = byDepartment.get(node.id) ?? [];

    const seen = new Set<string>();
    const subordinates = [...members, ...(isMain ? orphans : [])].filter((user) => {
      if (user.id === node.headId || user.id === node.deputyId) return false;
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });

    const people = new Map<string, UserListItem>();
    for (const user of members) people.set(user.id, user);
    if (head) people.set(head.id, head);
    if (deputy) people.set(deputy.id, deputy);
    if (isMain) for (const user of orphans) people.set(user.id, user);
    for (const child of node.children) {
      for (const [id, user] of visit(child, false)) people.set(id, user);
    }

    const headName = head?.displayName ?? node.headName;
    const cardHead =
      node.headId && headName
        ? {
            id: node.headId,
            name: headName,
            positionName: head?.positionName ?? null,
            avatarUrl: head?.avatarUrl ?? null,
          }
        : null;

    stats.set(node.id, {
      head: cardHead,
      deputies: deputy ? [deputy] : [],
      subordinates,
      // Уволенный/не загруженный руководитель в people не попадает — и не вычитается.
      teamCount: people.size - (head ? 1 : 0),
      departmentCount: node.children.length,
    });
    return people;
  };

  for (const root of roots) visit(root, root.id === opts.mainId);
  return stats;
}
