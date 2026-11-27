import { http, HttpResponse } from 'msw';
import {
  createDepartmentSchema,
  departmentTreeQuerySchema,
  ErrorCode,
  updateDepartmentSchema,
  type Department,
  type UserListItem,
} from '@nodus/contracts';

import { DEPARTMENTS_TREE_PATH } from '../../../../shared/api/departments-list.js';
import { buildDepartmentTree } from '../../../../shared/mocks/data/departments.js';
import { demoUserCards } from '../../../../shared/mocks/data/users.js';

/**
 * Моки подразделений (#84, #946, #817): дерево и CRUD поверх concept-state
 * списка сотрудников. Назначение главы/замов переводит сотрудников в узел —
 * паритет с серверным правилом «одно место»; глава не входит в список замов,
 * один сотрудник — зам ровно одного отдела.
 */

export interface DepartmentMockState {
  getDepartments: () => Department[];
  setDepartments: (next: Department[]) => void;
  getUsers: () => UserListItem[];
  setUsers: (next: UserListItem[]) => void;
}

function sameLeaders(headId: string | null | undefined, deputyIds: readonly string[]) {
  return !!headId && deputyIds.some((deputyId) => deputyId.toLowerCase() === headId.toLowerCase());
}

function sameLeaderError() {
  return HttpResponse.json(
    {
      code: 'VALIDATION_FAILED',
      message: 'Head and deputy must differ',
      details: { field: 'deputyIds', reason: 'same_as_head' },
    },
    { status: 400 },
  );
}

export function departmentHandlers(state: DepartmentMockState) {
  const leaderSet = (headId: string | null | undefined, deputyIds: readonly string[]) =>
    new Set([headId ?? '', ...deputyIds].filter(Boolean));

  /** #817: место главы/зама одно на человека — прежние узлы его теряют. */
  function clearSeatsElsewhere(
    headId: string | null | undefined,
    deputyIds: readonly string[],
    departmentId: string,
  ): void {
    const leaders = leaderSet(headId, deputyIds);
    if (leaders.size === 0) return;
    state.setDepartments(
      state.getDepartments().map((department) => {
        if (department.id === departmentId) return department;
        const headRemoved = department.headId !== null && leaders.has(department.headId);
        const remaining = department.deputyIds.filter((deputyId) => !leaders.has(deputyId));
        if (!headRemoved && remaining.length === department.deputyIds.length) return department;
        return {
          ...department,
          headId: headRemoved ? null : department.headId,
          deputyIds: remaining,
        };
      }),
    );
  }

  /** #946: назначение в управленческий узел переводит сотрудника (членство). */
  function moveMembers(
    headId: string | null | undefined,
    deputyIds: readonly string[],
    departmentId: string,
  ): void {
    const leaders = leaderSet(headId, deputyIds);
    if (leaders.size === 0) return;
    state.setUsers(
      state.getUsers().map((user) => (leaders.has(user.id) ? { ...user, departmentId } : user)),
    );
    for (const card of demoUserCards) {
      if (leaders.has(card.id)) card.departmentId = departmentId;
    }
  }

  /** Паритет с сервером: место снимается всегда, перевод — только management
   *  (юридическая структура формальная). */
  function applyLeaders(
    headId: string | null | undefined,
    deputyIds: readonly string[],
    department: Department,
  ): void {
    clearSeatsElsewhere(headId, deputyIds, department.id);
    if (department.kind === 'management') moveMembers(headId, deputyIds, department.id);
  }

  return [
    http.get(`/api/v1${DEPARTMENTS_TREE_PATH}`, ({ request }) => {
      const url = new URL(request.url);
      const query = departmentTreeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      const kind = query.success ? query.data.kind : 'management';
      // Дерево — из concept-state, иначе POST/PATCH теряются на рефетче после
      // оптимистичной мутации (валидация 24.09).
      return HttpResponse.json(buildDepartmentTree(kind, state.getUsers(), state.getDepartments()));
    }),
    http.post('/api/v1/directory/departments', async ({ request }) => {
      const parsed = createDepartmentSchema.safeParse(await request.json());
      if (!parsed.success)
        return HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'Invalid department payload' },
          { status: 400 },
        );
      const department: Department = {
        id: crypto.randomUUID(),
        isActive: true,
        ...parsed.data,
      };
      if (sameLeaders(department.headId, department.deputyIds)) return sameLeaderError();
      state.setDepartments([...state.getDepartments(), department]);
      applyLeaders(department.headId, department.deputyIds, department);
      return HttpResponse.json(department, { status: 201 });
    }),
    http.delete('/api/v1/directory/departments/:id', ({ params }) => {
      const current = state.getDepartments().find((d) => d.id === params.id);
      if (!current)
        return HttpResponse.json(
          { code: 'NOT_FOUND', message: 'Department not found' },
          { status: 404 },
        );
      if (current.kind === 'legal')
        return HttpResponse.json(
          {
            code: ErrorCode.DIRECTORY_DEPARTMENT_LEGAL_FORBIDDEN,
            message: 'Legal department cannot be deleted',
          },
          { status: 409 },
        );
      if (current.parentId === null)
        return HttpResponse.json(
          {
            code: ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
            message: 'Management department root cannot be deleted',
          },
          { status: 409 },
        );
      const parentId = current.parentId;
      state.setDepartments(
        state
          .getDepartments()
          .filter((department) => department.id !== current.id)
          .map((department) =>
            department.parentId === current.id ? { ...department, parentId } : department,
          ),
      );
      state.setUsers(
        state
          .getUsers()
          .map((user) =>
            user.departmentId === current.id ? { ...user, departmentId: parentId } : user,
          ),
      );
      for (const card of demoUserCards) {
        if (card.departmentId === current.id) card.departmentId = parentId;
      }
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('/api/v1/directory/departments/:id', async ({ params, request }) => {
      const parsed = updateDepartmentSchema.safeParse(await request.json());
      if (!parsed.success)
        return HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'Invalid department patch' },
          { status: 400 },
        );
      const current = state.getDepartments().find((d) => d.id === params.id);
      if (!current)
        return HttpResponse.json(
          { code: 'NOT_FOUND', message: 'Department not found' },
          { status: 404 },
        );
      // Паритет с сервером (#982): управленческий узел в корень не открепляется.
      if (
        parsed.data.parentId === null &&
        current.kind === 'management' &&
        current.parentId !== null
      )
        return HttpResponse.json(
          {
            code: ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
            message: 'Management department cannot be detached to root',
          },
          { status: 409 },
        );
      const next: Department = { ...current, ...parsed.data };
      if (sameLeaders(next.headId, next.deputyIds)) return sameLeaderError();
      state.setDepartments(
        state.getDepartments().map((department) => (department.id === next.id ? next : department)),
      );
      applyLeaders(next.headId, next.deputyIds, next);
      return HttpResponse.json(next);
    }),
  ];
}
