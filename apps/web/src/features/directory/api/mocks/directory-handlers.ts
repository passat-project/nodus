import { http, HttpResponse } from 'msw';
import {
  createDepartmentSchema,
  createInvitationSchema,
  departmentTreeQuerySchema,
  listUsersQuerySchema,
  updateDepartmentSchema,
} from '@nodus/contracts';

import {
  buildDepartmentTree,
  demoDepartments,
  departmentOfUser,
} from '../../../../shared/mocks/data/departments.js';
import { DEPARTMENTS_TREE_PATH } from '../../../../shared/api/departments-list.js';
import {
  demoPresence,
  demoUserCards,
  demoUserListItems,
} from '../../../../shared/mocks/data/users.js';

/**
 * MSW-слой справочника (ADR-0001): контракты — источник формы ответов.
 * Дерево подразделений (GET /directory/departments/tree?kind=) и фильтр людей по
 * подразделению (принадлежность в ТОЙ структуре, к которой относится отдел —
 * семантика контракта listUsersQuerySchema.departmentId, #84) — образец для
 * бэкенд-агента: UI сверстан по этим контрактам и есть ТЗ на эндпоинты.
 * Создание/правка подразделения (POST/PATCH — канон методов api-conventions)
 * живут в локальном сторе на время сессии (concept-state), zod-валидация тел —
 * схемами contracts.
 */
let departmentState = demoDepartments;

export const directoryHandlers = [
  http.get('/api/v1/directory/users', ({ request }) => {
    const url = new URL(request.url);
    const query = listUsersQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    let items = demoUserListItems;
    if (query.success && query.data.departmentId) {
      const department = departmentState.find((d) => d.id === query.data.departmentId);
      if (department)
        items = items.filter((u) => departmentOfUser(u, department.kind) === department.id);
    }
    return HttpResponse.json({ items, nextCursor: null });
  }),
  http.get(`/api/v1${DEPARTMENTS_TREE_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const query = departmentTreeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    const kind = query.success ? query.data.kind : 'management';
    // Дерево — из concept-state (departmentState), иначе POST/PATCH теряются
    // на рефетче после оптимистичной мутации (валидация 24.09).
    return HttpResponse.json(buildDepartmentTree(kind, demoUserListItems, departmentState));
  }),
  http.post('/api/v1/directory/departments', async ({ request }) => {
    const parsed = createDepartmentSchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid department payload' },
        { status: 400 },
      );
    const department = {
      id: crypto.randomUUID(),
      isActive: true,
      ...parsed.data,
    };
    departmentState = [...departmentState, department];
    return HttpResponse.json(department, { status: 201 });
  }),
  http.patch('/api/v1/directory/departments/:id', async ({ params, request }) => {
    const parsed = updateDepartmentSchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid department patch' },
        { status: 400 },
      );
    const current = departmentState.find((d) => d.id === params.id);
    if (!current)
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Department not found' },
        { status: 404 },
      );
    const next = { ...current, ...parsed.data };
    departmentState = departmentState.map((d) => (d.id === next.id ? next : d));
    return HttpResponse.json(next);
  }),
  http.get('/api/v1/directory/presence', () => HttpResponse.json(demoPresence)),
  /** Полная карточка сотрудника (UserCard: контактный блок, даты HR) —
   *  вкладка «Профиль» карточки сотрудника. */
  http.get('/api/v1/directory/users/:id', ({ params }) => {
    const card = demoUserCards.find((u) => u.id === params.id);
    if (!card)
      return HttpResponse.json({ code: 'NOT_FOUND', message: 'User not found' }, { status: 404 });
    return HttpResponse.json(card);
  }),
  /** Приглашение сотрудника (кнопка «Пригласить») — заготовка: принимает
   *  email, полный поток (роль, подразделение, письмо-инвайт) — с бэкендом. */
  http.post('/api/v1/directory/invitations', async ({ request }) => {
    const parsed = createInvitationSchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid email' },
        { status: 400 },
      );
    return HttpResponse.json({ id: crypto.randomUUID() }, { status: 201 });
  }),
];
