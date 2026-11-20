import type { DepartmentNode } from '@nodus/contracts';

import type { DepartmentRow } from './departments.repository.js';

/** Заместители узла в порядке назначения (#817): уникальные id. */
export function deputyIdsOf(row: DepartmentRow): string[] {
  return (row.deputies ?? []).map((deputy) => deputy.userId);
}

/** Уникальные id с сохранением порядка первого вхождения. */
export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** DTO узла дерева: денормализованные имена и заместители (#817). */
export function toNode(row: DepartmentRow, children: DepartmentNode[]): DepartmentNode {
  const deputies = (row.deputies ?? []).map((deputy) => ({
    id: deputy.user.id,
    displayName: deputy.user.displayName,
  }));
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
    headId: row.headId,
    deputyIds: deputies.map((deputy) => deputy.id),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    headName: row.head?.displayName ?? null,
    deputies,
    memberCount: row.kind === 'legal' ? row._count.legalMembers : row._count.members,
    children,
  };
}
