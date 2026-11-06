import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  Permission,
  createProjectBodySchema,
  projectMemberAddBodySchema,
  projectStatusBodySchema,
  projectTransferBodySchema,
  updateProjectBodySchema,
} from '@nodus/contracts';

import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { counterpartyRefById } from '../../../../shared/mocks/data/counterparties.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { accessOf, detailOf, myMembershipOf } from '../../../../shared/mocks/data/project-views.js';
import {
  addDemoProjectMember,
  createDemoProject,
  joinDemoProject,
  leaveDemoProject,
  removeDemoProjectMember,
  setDemoProjectStatus,
  transferDemoProject,
  updateDemoProject,
} from '../../../../shared/mocks/data/project-store.js';
import {
  demoProjectGroups,
  demoProjectTypes,
  findDemoProjectRow,
} from '../../../../shared/mocks/data/projects.js';

const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
const forbidden = () =>
  HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Project not found' }, { status: 404 });

/** Запись проектов в моках (#52): создание/правка/статусы/руководство/
 *  участие — зеркало серверных правил, чтобы приёмка на демо-мире видела
 *  те же отказы (I8 на клиенте — только UX, сервер в проде истина). */
export const projectMutationHandlers = [
  http.post('/api/v1/projects', async ({ request }) => {
    const actor = getMockActor();
    if (!actor.permissions.includes(Permission.PROJECT_CREATE)) return forbidden();
    const parsed = createProjectBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    const type = demoProjectTypes.find((entry) => entry.id === body.typeId);
    if (!type || type.archivedAt !== null) return invalid();
    if (body.portfolioId) {
      const portfolio = demoProjectGroups.find((entry) => entry.id === body.portfolioId);
      if (!portfolio || portfolio.archivedAt !== null) return invalid();
    }
    if (body.clientId && !counterpartyRefById(body.clientId)) return invalid();
    const row = createDemoProject(body, actor);
    return HttpResponse.json(detailOf(row, actor), { status: 201 });
  }),

  http.patch('/api/v1/projects/:id', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManage) return forbidden();
    const parsed = updateProjectBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    if (
      body.visibility === 'secret' &&
      row.visibility !== 'secret' &&
      row.managerId !== actor.id &&
      !actor.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      return forbidden();
    }
    if (body.portfolioId) {
      const portfolio = demoProjectGroups.find((entry) => entry.id === body.portfolioId);
      if (!portfolio || portfolio.archivedAt !== null) return invalid();
    }
    if (body.clientId && !counterpartyRefById(body.clientId)) return invalid();
    const updated = updateDemoProject(row.id, body, actor.id);
    return updated ? HttpResponse.json(detailOf(updated, actor)) : notFound();
  }),

  http.post('/api/v1/projects/:id/status', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManage) return forbidden();
    if (
      row.status === 'archived' &&
      row.managerId !== actor.id &&
      !actor.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      return forbidden();
    }
    const parsed = projectStatusBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const updated = setDemoProjectStatus(row.id, parsed.data.status, actor.id);
    return updated ? HttpResponse.json(detailOf(updated, actor)) : notFound();
  }),

  http.post('/api/v1/projects/:id/transfer', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    if (row.managerId !== actor.id) return forbidden();
    const parsed = projectTransferBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const target = demoUserListItems.find(
      (user) => user.id === parsed.data.managerId && user.status === 'active',
    );
    if (!target) return notFound();
    const updated = transferDemoProject(row.id, target.id, actor.id);
    return updated ? HttpResponse.json(detailOf(updated, actor)) : notFound();
  }),

  http.post('/api/v1/projects/:id/join', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row || row.visibility !== 'open') return notFound();
    joinDemoProject(row.id, actor);
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/api/v1/projects/:id/leave', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    leaveDemoProject(row.id, actor);
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/api/v1/projects/:id/members', async ({ params, request }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManageMembers) return forbidden();
    const parsed = projectMemberAddBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    // Открытый проект: участники живут из задач, руками — только наблюдатель.
    if (row.visibility !== 'secret' && parsed.data.kind === 'member') return invalid();
    const target = demoUserListItems.find(
      (user) => user.id === parsed.data.userId && user.status === 'active',
    );
    if (!target) return notFound();
    addDemoProjectMember(row.id, target.id, parsed.data.kind, actor.id);
    return new HttpResponse(null, { status: 201 });
  }),

  http.delete('/api/v1/projects/:id/members/:userId', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManageMembers) return forbidden();
    removeDemoProjectMember(row.id, String(params.userId), actor.id, row.visibility !== 'secret');
    return new HttpResponse(null, { status: 200 });
  }),
];
