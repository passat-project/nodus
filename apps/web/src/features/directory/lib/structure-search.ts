import type { DepartmentNode, UserListItem } from '@nodus/contracts';

/**
 * Поиск по структуре (#768): отделы и АКТИВНЫЕ сотрудники одной
 * строкой. Дерево не фильтруется — выбор результата раскрывает предков,
 * центрирует канвас и открывает панель. Сотрудник без управленческого
 * отдела (или с архивным) показывается в главной карточке компании.
 */

export interface StructureSearchResults {
  departments: DepartmentNode[];
  employees: UserListItem[];
}

/** Все узлы дерева в порядке обхода (родитель раньше детей). */
export function flattenDepartmentNodes(roots: DepartmentNode[]): DepartmentNode[] {
  const list: DepartmentNode[] = [];
  const walk = (nodes: DepartmentNode[]) => {
    for (const node of nodes) {
      list.push(node);
      walk(node.children);
    }
  };
  walk(roots);
  return list;
}

/** Id всех активных отделов дерева (для «без отдела»). */
export function activeDepartmentIds(roots: DepartmentNode[]): Set<string> {
  return new Set(flattenDepartmentNodes(roots).map((node) => node.id));
}

/** Главная карточка компании — первый корень (вердикт 12.11.2026). */
export function mainDepartmentId(roots: DepartmentNode[]): string | null {
  return roots[0]?.id ?? null;
}

/**
 * Отдел, в котором сотрудник показан в структуре: свой активный
 * управленческий, иначе главная карточка компании (нет/архив). Данные
 * `departmentId`/`managerId` при этом не переписываются — это отображение.
 */
export function structureDepartmentOf(
  user: UserListItem,
  activeIds: ReadonlySet<string>,
  mainId: string | null,
): string | null {
  if (user.departmentId && activeIds.has(user.departmentId)) return user.departmentId;
  return mainId;
}

/** Живой поиск по названиям отделов и ФИО/должностям активных. */
export function searchStructure(
  roots: DepartmentNode[],
  users: readonly UserListItem[],
  query: string,
): StructureSearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { departments: [], employees: [] };
  return {
    departments: flattenDepartmentNodes(roots).filter((node) =>
      node.name.toLowerCase().includes(q),
    ),
    employees: users
      .filter((user) => user.status === 'active')
      .filter(
        (user) =>
          user.displayName.toLowerCase().includes(q) ||
          (user.positionName ?? '').toLowerCase().includes(q),
      ),
  };
}
