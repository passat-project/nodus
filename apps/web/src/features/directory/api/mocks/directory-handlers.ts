import { http, HttpResponse } from 'msw';
import {
  createDepartmentSchema,
  createInvitationSchema,
  createPositionSchema,
  departmentTreeQuerySchema,
  listUsersQuerySchema,
  reassignPositionSchema,
  updateDepartmentSchema,
  updatePositionSchema,
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
import { demoPositions } from '../../../../shared/mocks/data/positions.js';

/**
 * MSW-слой справочника (ADR-0001): контракты — источник формы ответов.
 * Дерево отделов (GET /directory/departments/tree?kind=) и фильтр людей по
 * отделу (принадлежность в ТОЙ структуре, к которой относится отдел —
 * семантика контракта listUsersQuerySchema.departmentId, #84) — образец для
 * бэкенд-агента: UI сверстан по этим контрактам и есть ТЗ на эндпоинты.
 * Создание/правка отдела (POST/PATCH — канон методов api-conventions)
 * живут в локальном сторе на время сессии (concept-state), zod-валидация тел —
 * схемами contracts.
 */
let departmentState = demoDepartments;
let positionState = demoPositions;
let userState = demoUserListItems;

export const directoryHandlers = [
  // Должности (#441/#433/#768): справочник управленческих и юридических;
  // удаление/переназначение — как на сервере (держатели, жёсткое удаление).
  http.get('/api/v1/directory/positions', ({ request }) => {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') === 'legal' ? 'legal' : 'management';
    return HttpResponse.json(positionState.filter((position) => position.kind === kind));
  }),
  http.post('/api/v1/directory/positions', async ({ request }) => {
    const parsed = createPositionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid position payload' },
        { status: 400 },
      );
    }
    const position = { id: crypto.randomUUID(), ...parsed.data };
    positionState = [...positionState, position];
    return HttpResponse.json(position, { status: 201 });
  }),
  http.patch('/api/v1/directory/positions/:id', async ({ params, request }) => {
    const parsed = updatePositionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid position patch' },
        { status: 400 },
      );
    }
    const current = positionState.find((position) => position.id === params.id);
    if (!current) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Position not found' },
        { status: 404 },
      );
    }
    const next = { ...current, ...parsed.data };
    positionState = positionState.map((position) => (position.id === next.id ? next : position));
    return HttpResponse.json(next);
  }),
  http.post('/api/v1/directory/positions/:id/reassign', async ({ params, request }) => {
    const parsed = reassignPositionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid reassign payload' },
        { status: 400 },
      );
    }
    // Как на сервере (#768): переносятся ВСЕ держатели, включая уволенных —
    // отдельного архива должностей у уволенных нет (вердикт 13.11.2026).
    userState = userState.map((user) =>
      user.positionId === params.id ? { ...user, positionId: parsed.data.targetId } : user,
    );
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('/api/v1/directory/positions/:id', ({ params }) => {
    const current = positionState.find((position) => position.id === params.id);
    if (!current) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Position not found' },
        { status: 404 },
      );
    }
    // Считаем ВСЕХ держателей, как сервер: уволенные тоже ссылаются на строку.
    const holders = userState.filter((user) => user.positionId === params.id).length;
    if (holders > 0) {
      return HttpResponse.json(
        {
          code: 'DIRECTORY_POSITION_IN_USE',
          message: 'Position has holders',
          details: { positionId: params.id, reason: 'holders', holders },
        },
        { status: 409 },
      );
    }
    positionState = positionState.filter((position) => position.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/v1/directory/users', ({ request }) => {
    const url = new URL(request.url);
    const query = listUsersQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    let items = userState;
    if (query.success && query.data.departmentId) {
      const department = departmentState.find((d) => d.id === query.data.departmentId);
      if (department)
        items = items.filter((u) => departmentOfUser(u, department.kind) === department.id);
    }
    // Фильтры контракта honoured как на сервере (#723): иначе уволенный из
    // демо-справочника всплывал в пикерах, которые просят `status=active`, и в
    // поиске по ФИО отвечал кто угодно.
    if (query.success && query.data.status) {
      items = items.filter((u) => u.status === query.data.status);
    }
    if (query.success && query.data.search) {
      const needle = query.data.search.toLowerCase();
      items = items.filter((u) => `${u.displayName} ${u.email}`.toLowerCase().includes(needle));
    }
    return HttpResponse.json({ items, nextCursor: null });
  }),
  http.get(`/api/v1${DEPARTMENTS_TREE_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const query = departmentTreeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    const kind = query.success ? query.data.kind : 'management';
    // Дерево — из concept-state (departmentState), иначе POST/PATCH теряются
    // на рефетче после оптимистичной мутации (валидация 24.09).
    return HttpResponse.json(buildDepartmentTree(kind, userState, departmentState));
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
  /** Возврат деактивированного сотрудника в работу (AUD-016): зеркало
   *  деактивации. Тела нет — ответ по контракту `UserCard`; повтор на уже
   *  активном сотруднике идемпотентен (та же карточка без изменений).
   *  Демо-стор мутируется на время сессии, как у отделов. */
  http.post('/api/v1/directory/users/:id/activate', ({ params }) => {
    const id = String(params.id);
    const card = demoUserCards.find((u) => u.id === id);
    if (!card)
      return HttpResponse.json({ code: 'NOT_FOUND', message: 'User not found' }, { status: 404 });
    if (card.status !== 'active') {
      card.status = 'active';
      const item = demoUserListItems.find((u) => u.id === id);
      if (item) item.status = 'active';
    }
    return HttpResponse.json(card);
  }),
  /** Приглашение сотрудника (кнопка «Пригласить») — заготовка: принимает
   *  email, полный поток (роль, отдел, письмо-инвайт) — с бэкендом. */
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
