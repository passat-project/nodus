import type { Department, DepartmentNode, OrgUnitKind, UserListItem } from '@nodus/contracts';

import { activeStaffCount } from '../../lib/staff-count.js';
import { departmentIds } from './org-ids.js';
import { userIds } from './users.js';

/**
 * Демо-оргструктура (#84, модель M2 #18): ДВЕ структуры расходятся, как в жизни
 * ПассатПроекта. Управленческая: ПассатПроект → [Проектное → BIM-отдел,
 * Административное]; руководитель BIM-отдела подчиняется главе «Проектного» —
 * с #923 (ADR-0053) подчинённость производна от дерева, ручных «мимо дерева»
 * связей нет. Юридическая: все инженеры по трудовой — «инженеры-проектировщики»
 * в «Группе ГИПов» (требование 3 #18); юридическая структура руководителей не
 * определяет (только управленческая).
 */
export const demoDepartments: Department[] = [
  {
    id: departmentIds.company,
    name: 'ПассатПроект',
    kind: 'management',
    parentId: null,
    headId: userIds.shaiderova,
    deputyIds: [],
    sortOrder: 0,
    isActive: true,
  },
  {
    id: departmentIds.project,
    name: 'Проектное',
    kind: 'management',
    parentId: departmentIds.company,
    headId: userIds.vinnichek,
    deputyIds: [userIds.kuralenya],
    sortOrder: 0,
    isActive: true,
  },
  {
    id: departmentIds.bim,
    name: 'BIM-отдел',
    kind: 'management',
    parentId: departmentIds.project,
    headId: userIds.klimovich,
    deputyIds: [userIds.klevantovich],
    sortOrder: 0,
    isActive: true,
  },
  {
    id: departmentIds.admin,
    name: 'Административное',
    kind: 'management',
    parentId: departmentIds.company,
    headId: userIds.karpovich,
    deputyIds: [],
    sortOrder: 1,
    isActive: true,
  },
  {
    id: departmentIds.legalCompany,
    name: 'ПассатПроект',
    kind: 'legal',
    parentId: null,
    headId: userIds.shaiderova,
    deputyIds: [],
    sortOrder: 0,
    isActive: true,
  },
  {
    id: departmentIds.legalGip,
    name: 'Группа ГИПов',
    kind: 'legal',
    parentId: departmentIds.legalCompany,
    headId: userIds.klevantovich,
    deputyIds: [userIds.klimovich],
    sortOrder: 0,
    isActive: true,
  },
];

/** Принадлежность сотрудника структуре: management → departmentId, legal → legalDepartmentId. */
export function departmentOfUser(user: UserListItem, kind: OrgUnitKind): string | null {
  return kind === 'management' ? user.departmentId : user.legalDepartmentId;
}

/**
 * Лес корней DepartmentNode для вида (контракт GET /directory/departments/tree?kind=):
 * children рекурсивно по parentId (сортировка sortOrder), memberCount —
 * НЕ-рекурсивно (прикреплённые к подразделению), денормализованные
 * руководитель/заместители — для UI без второго запроса.
 */
export function buildDepartmentTree(
  kind: OrgUnitKind,
  users: UserListItem[],
  source: Department[] = demoDepartments,
): DepartmentNode[] {
  const ofKind = source.filter((d) => d.kind === kind && d.isActive);
  const nameOf = (id: string | null): string | null =>
    id === null ? null : (users.find((u) => u.id === id)?.displayName ?? null);

  function node(department: Department): DepartmentNode {
    const children = ofKind
      .filter((d) => d.parentId === department.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(node);
    return {
      ...department,
      headName: nameOf(department.headId),
      deputies: department.deputyIds.map((deputyId) => ({
        id: deputyId,
        displayName: nameOf(deputyId) ?? '',
      })),
      // Штат подразделения (#723): как `memberCount` API
      // (`departments.repository.ts` — `members: { where: { status: 'active' } }`),
      // уволенные в число не входят, но остаются видимыми в панели.
      memberCount: activeStaffCount(
        users.filter((u) => departmentOfUser(u, kind) === department.id),
      ),
      children,
    };
  }

  const ids = new Set(ofKind.map((d) => d.id));
  return ofKind
    .filter((d) => d.parentId === null || !ids.has(d.parentId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(node);
}
