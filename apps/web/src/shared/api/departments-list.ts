import { useQuery } from '@tanstack/react-query';
import type { DepartmentNode } from '@nodus/contracts';

import { api } from '../api-client.js';

/** Контрактный путь дерева оргструктуры (#540): единый источник для всех
 *  потребителей web — вид «Подразделения», пикеры полей, состав роли.
 *  API-маршрут: `apps/api/src/modules/directory/departments.controller.ts`
 *  (`@Get('tree')`); страж — `departments-list.test.ts`. */
export const DEPARTMENTS_TREE_PATH = '/directory/departments/tree';

/** Ключ СОВПАДАЕТ с `directoryKeys.departments('management')` (фича
 *  directory) — общий кэш дерева, как `usersListKey`: пикер подразделений
 *  в полях не платит вторым запросом. */
export const departmentsListKey = ['directory', 'departments', 'management'] as const;

/** Управленческое дерево подразделений (пикеры и фильтры полей «Подразделение»). */
export function useDepartmentTreeManagement() {
  return useQuery({
    queryKey: departmentsListKey,
    queryFn: () => api<DepartmentNode[]>(`${DEPARTMENTS_TREE_PATH}?kind=management`),
    staleTime: 60_000,
  });
}

/** Плоский список управленческих подразделений в порядке дерева (обход
 *  сверху вниз): подписи и уровни для выпадающих списков. */
export interface DepartmentOption {
  id: string;
  name: string;
  /** 0 — корень, 1 — подразделение верхнего уровня и т.д. */
  depth: number;
  isActive: boolean;
}

export function flattenDepartments(
  nodes: readonly DepartmentNode[],
  depth = 0,
): DepartmentOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth, isActive: node.isActive },
    ...flattenDepartments(node.children, depth + 1),
  ]);
}

export function useDepartmentsList(): DepartmentOption[] {
  const { data } = useDepartmentTreeManagement();
  return flattenDepartments(data ?? []);
}
