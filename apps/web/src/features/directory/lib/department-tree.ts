import type { DepartmentNode, UpdateDepartmentDto, UserListItem } from '@nodus/contracts';

/** Чистые операции над деревом подразделений и фокус-графом подчинённости (#84):
 *  UI-виды и оптимистичные мутации кэша (I4) — из этих функций, без состояния. */

/** Сотрудники подразделения с учётом подподразделений (memberCount не рекурсивен). */
export function totalEmployees(node: DepartmentNode): number {
  return node.memberCount + node.children.reduce((sum, child) => sum + totalEmployees(child), 0);
}

/** Узел по id (панель подразделения) или null. */
export function findDepartment(roots: DepartmentNode[], id: string): DepartmentNode | null {
  for (const node of roots) {
    if (node.id === id) return node;
    const inner = findDepartment(node.children, id);
    if (inner) return inner;
  }
  return null;
}

/** Поиск по названию: ветки без совпадений выпадают, совпавший узел остаётся
 *  с поддеревом целиком (контекст важнее точечной подсветки). */
export function filterTreeByName(roots: DepartmentNode[], query: string): DepartmentNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return roots;
  const walk = (node: DepartmentNode): DepartmentNode | null => {
    if (node.name.toLowerCase().includes(q)) return node;
    const children = node.children.map(walk).filter((n): n is DepartmentNode => n !== null);
    return children.length > 0 ? { ...node, children } : null;
  };
  return roots.map(walk).filter((n): n is DepartmentNode => n !== null);
}

/** Оптимистичная вставка узла (кэш дерева, I4): parentId null — новый корень. */
export function insertDepartment(roots: DepartmentNode[], node: DepartmentNode): DepartmentNode[] {
  if (node.parentId === null) return [...roots, node];
  const walk = (current: DepartmentNode): DepartmentNode =>
    current.id === node.parentId
      ? { ...current, children: [...current.children, node] }
      : { ...current, children: current.children.map(walk) };
  return roots.map(walk);
}

/** Оптимистичный патч узла (кэш дерева, I4); денормализованные имена и счётчики
 *  доносит инвалидация после ответа сервера. Набор заместителей (#817)
 *  переводится из `deputyIds` в `deputies`: имена известных сохраняются, новые
 *  подхватит инвалидация (до неё панель резолвит имена из справочника сотрудников). */
export function patchDepartment(
  roots: DepartmentNode[],
  id: string,
  patch: UpdateDepartmentDto,
): DepartmentNode[] {
  const walk = (current: DepartmentNode): DepartmentNode => {
    let next: DepartmentNode = current;
    if (current.id === id) {
      next = {
        ...current,
        ...patch,
        parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
      };
      if (patch.deputyIds !== undefined) {
        const known = new Map(current.deputies.map((deputy) => [deputy.id, deputy] as const));
        const deputies = patch.deputyIds.map(
          (deputyId) => known.get(deputyId) ?? { id: deputyId, displayName: '' },
        );
        next = { ...next, deputyIds: deputies.map((deputy) => deputy.id), deputies };
      }
    }
    return { ...next, children: next.children.map(walk) };
  };
  return roots.map(walk);
}

/**
 * Фокус-множество людей для вида «Подчинённость»: цепочка руководителей ВВЕРХ
 * от фокуса + прямые подчинённые фокуса + прямые подчинённые раскрытых узлов
 * (раскрытие пошаговое, без лавины в 300 человек). Корни множества — у кого
 * руководитель вне множества: цепочка выстроится вертикалью сама.
 */
export function focusSubset(
  people: UserListItem[],
  focusId: string,
  expanded: ReadonlySet<string>,
): UserListItem[] {
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const reports = (id: string) => people.filter((p) => p.managerId === id);
  const picked = new Map<string, UserListItem>();
  const add = (person: UserListItem | undefined) => {
    if (person) picked.set(person.id, person);
  };

  add(byId.get(focusId));
  let cursor = byId.get(focusId)?.managerId ?? null;
  const seen = new Set<string>([focusId]);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    add(byId.get(cursor));
    cursor = byId.get(cursor)?.managerId ?? null;
  }
  reports(focusId).forEach(add);
  for (const id of expanded) reports(id).forEach(add);
  return people.filter((p) => picked.has(p.id));
}

/** Нераскрытые дети узла множества (кнопка «+N» в виде «Подчинённость»). */
export function hiddenReportsCount(
  people: UserListItem[],
  rendered: ReadonlySet<string>,
  id: string,
): number {
  return people.filter((p) => p.managerId === id && !rendered.has(p.id)).length;
}
