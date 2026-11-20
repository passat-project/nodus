import { http, HttpResponse } from 'msw';
import {
  createDepartmentSchema,
  departmentTreeQuerySchema,
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
  /** #946: переводит назначенного главу/зама в узел; прежний узел теряет роль. */
  function transferLeader(userId: string | null | undefined, departmentId: string): void {
    if (!userId) return;
    state.setDepartments(
      state.getDepartments().map((department) => {
        if (department.id === departmentId) return department;
        return {
          ...department,
          headId: department.headId === userId ? null : department.headId,
          deputyIds: department.deputyIds.filter((deputyId) => deputyId !== userId),
        };
      }),
    );
    state.setUsers(
      state.getUsers().map((user) => (user.id === userId ? { ...user, departmentId } : user)),
    );
    const card = demoUserCards.find((candidate) => candidate.id === userId);
    if (card) card.departmentId = departmentId;
  }

  /** #817: зам — ровно одного отдела: чужой сотрудник переезжает сюда. */
  function transferLeaders(
    headId: string | null | undefined,
    deputyIds: readonly string[],
    departmentId: string,
  ): void {
    for (const userId of new Set([headId ?? '', ...deputyIds])) {
      transferLeader(userId, departmentId);
    }
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
      if (department.kind === 'management') {
        transferLeaders(department.headId, department.deputyIds, department.id);
      }
      return HttpResponse.json(department, { status: 201 });
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
      const next: Department = { ...current, ...parsed.data };
      if (sameLeaders(next.headId, next.deputyIds)) return sameLeaderError();
      state.setDepartments(
        state.getDepartments().map((department) => (department.id === next.id ? next : department)),
      );
      if (next.kind === 'management') {
        transferLeaders(next.headId, next.deputyIds, next.id);
      }
      return HttpResponse.json(next);
    }),
  ];
}
