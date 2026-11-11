import { http, HttpResponse } from 'msw';
import { projectMemberAddBodySchema } from '@nodus/contracts';

import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { accessOf, myMembershipOf } from '../../../../shared/mocks/data/project-views.js';
import {
  addDemoProjectMember,
  joinDemoProject,
  leaveDemoProject,
  removeDemoProjectMember,
} from '../../../../shared/mocks/data/project-member-store.js';
import {
  demoParticipantRowsOf,
  findDemoProjectRow,
} from '../../../../shared/mocks/data/projects.js';
import {
  alreadyParticipant,
  forbidden,
  invalid,
  memberHasTasks,
  notFound,
} from './project-mutation-responses.js';

/**
 * Мутации состава мок-мира (#52, #714): вступление/уход, ручное добавление и
 * снятие. Зеркало серверных правил и причин отказа — наблюдатель участнику из
 * задач открытого проекта и держателю ролей в задачах секретного, осевшие
 * ручные строки снимаются самолечением. Вынесено из
 * project-mutation-handlers.ts ради лимита файла (I5).
 */
export const projectMemberMutationHandlers = [
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
    const targetRows = demoParticipantRowsOf(row.id).filter((entry) => entry.userId === target.id);
    // Наблюдатель не добавляет доступа участнику из задач открытого проекта.
    if (
      row.visibility !== 'secret' &&
      parsed.data.kind === 'observer' &&
      targetRows.some((entry) => entry.source === 'task')
    ) {
      return alreadyParticipant();
    }
    // Повтор той же роли — не действие.
    if (
      targetRows.some(
        (entry) =>
          entry.source === parsed.data.kind &&
          (parsed.data.kind === 'member' || entry.observerKind === 'invited'),
      )
    ) {
      return new HttpResponse(null, { status: 201 });
    }
    addDemoProjectMember(row.id, target.id, parsed.data.kind, actor.id);
    return new HttpResponse(null, { status: 201 });
  }),

  http.delete('/api/v1/projects/:id/members/:userId', ({ params }) => {
    const actor = getMockActor();
    const row = findDemoProjectRow(String(params.id));
    if (!row) return notFound();
    const membership = myMembershipOf(row.id, actor.id);
    if (!accessOf(row, membership, actor.permissions).canManageMembers) return forbidden();
    const userId = String(params.userId);
    const targetRows = demoParticipantRowsOf(row.id).filter((entry) => entry.userId === userId);
    // Секретный: держателя ролей в задачах сначала снимают с задач (#714).
    if (row.visibility === 'secret' && targetRows.some((entry) => entry.source === 'task')) {
      return memberHasTasks();
    }
    // Ручной строки нет — снимать нечего: участнику из задач отвечаем
    // причиной, остальным — 404 (ложного «убран» нет).
    if (!targetRows.some((entry) => entry.source === 'member' || entry.source === 'observer')) {
      return targetRows.some((entry) => entry.source === 'task')
        ? alreadyParticipant()
        : notFound();
    }
    removeDemoProjectMember(row.id, userId, actor.id);
    return new HttpResponse(null, { status: 200 });
  }),
];
