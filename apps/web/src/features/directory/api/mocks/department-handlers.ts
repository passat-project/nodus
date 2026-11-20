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
 * Моки подразделений (#84, #946): дерево и CRUD поверх concept-state списка
 * сотрудников. Назначение главы/зама переводит сотрудника в узел — паритет
 * с серверным правилом «одно место»; глава и зам одного узла — разные люди.
 */

export interface DepartmentMockState {
  getDepartments: () => Department[];
  setDepartments: (next: Department[]) => void;
  getUsers: () => UserListItem[];
  setUsers: (next: UserListItem[]) => void;
}

function sameLeaders(headId: string | null | undefined, deputyId: string | null | undefined) {
  return !!headId && !!deputyId && headId.toLowerCase() === deputyId.toLowerCase();
}

function sameLeaderError() {
  return HttpResponse.json(
    {
      code: 'VALIDATION_FAILED',
      message: 'Head and deputy must differ',
      details: { field: 'deputyId', reason: 'same_as_head' },
    },
    { status: 400 },
  );
}

export function departmentHandlers(state: DepartmentMockState) {
  /** #946: переводит назначенного главу/зама в узел; прежний узел теряет роль. */
  function transferLeader(userId: string | null | undefined, departmentId: string): void {
    if (!userId) return;
    state.setDepartments(
      state.getDepartments().map((department) => ({
        ...department,
        headId:
          department.id !== departmentId && department.headId === userId ? null : department.headId,
        deputyId:
          department.id !== departmentId && department.deputyId === userId
            ? null
            : department.deputyId,
      })),
    );
    state.setUsers(
      state.getUsers().map((user) => (user.id === userId ? { ...user, departmentId } : user)),
    );
    const card = demoUserCards.find((candidate) => candidate.id === userId);
    if (card) card.departmentId = departmentId;
  }

  function transferLeaders(
    headId: string | null | undefined,
    deputyId: string | null | undefined,
    departmentId: string,
  ): void {
    transferLeader(headId, departmentId);
    transferLeader(deputyId, departmentId);
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
      if (sameLeaders(department.headId, department.deputyId)) return sameLeaderError();
      state.setDepartments([...state.getDepartments(), department]);
      if (department.kind === 'management') {
        transferLeaders(department.headId, department.deputyId, department.id);
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
      if (sameLeaders(next.headId, next.deputyId)) return sameLeaderError();
      state.setDepartments(
        state.getDepartments().map((department) => (department.id === next.id ? next : department)),
      );
      if (next.kind === 'management') {
        transferLeaders(next.headId, next.deputyId, next.id);
      }
      return HttpResponse.json(next);
    }),
  ];
}
