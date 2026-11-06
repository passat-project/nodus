import { http, HttpResponse } from 'msw';
import { ErrorCode, listProjectsQuerySchema, type ProjectListItem } from '@nodus/contracts';

import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { projectWithFormulas } from '../../../../shared/custom-fields/formula/formula-dto.js';
import {
  canSeeProject,
  demoProjectMembersFor,
  detailOf,
  historyEntryOf,
  listItemOf,
  visibleProjectRows,
} from '../../../../shared/mocks/data/project-views.js';
import { demoProjectEvents } from '../../../../shared/mocks/data/project-events.js';
import {
  demoParticipantRowsOf,
  findDemoProjectRow,
} from '../../../../shared/mocks/data/projects.js';

const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Project not found' }, { status: 404 });

/** Чтение журнала/карточки/участников (#52): видимый срез, серверные
 *  фильтры, keyset-курсор — зеркало API на мок-мире. */
export const projectReadHandlers = [
  http.get('/api/v1/projects', ({ request }) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listProjectsQuerySchema.safeParse(params);
    if (!parsed.success) {
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid query' },
        { status: 422 },
      );
    }
    const query = parsed.data;
    const actor = getMockActor();
    let rows = visibleProjectRows(actor);
    if (query.scope === 'mine' || query.role) {
      rows = rows.filter((row) => demoParticipantRowsOf(row.id).some((p) => p.userId === actor.id));
    }
    if (query.role) {
      const sources = query.role === 'participant' ? ['task', 'member'] : [query.role];
      rows = rows.filter((row) =>
        demoParticipantRowsOf(row.id).some(
          (p) => p.userId === actor.id && sources.includes(p.source),
        ),
      );
    }
    if (query.visibility) rows = rows.filter((row) => row.visibility === query.visibility);
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.portfolioId) rows = rows.filter((row) => row.portfolioId === query.portfolioId);
    if (query.clientId) rows = rows.filter((row) => row.clientId === query.clientId);
    if (query.memberId) {
      rows = rows.filter((row) =>
        demoParticipantRowsOf(row.id).some((p) => p.userId === query.memberId),
      );
    }
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (row.code ?? '').toLowerCase().includes(needle),
      );
    }
    rows = [...rows].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    );
    if (query.cursor) {
      try {
        const cursor = JSON.parse(query.cursor) as { at: string; id: string };
        rows = rows.filter(
          (row) => row.updatedAt < cursor.at || (row.updatedAt === cursor.at && row.id < cursor.id),
        );
      } catch {
        return HttpResponse.json(
          { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid cursor' },
          { status: 422 },
        );
      }
    }
    const page = rows.slice(0, query.limit);
    const items: ProjectListItem[] = page.map((row) => listItemOf(row, actor));
    const last = page[page.length - 1];
    return HttpResponse.json({
      items,
      nextCursor:
        rows.length > query.limit && last
          ? JSON.stringify({ at: last.updatedAt, id: last.id })
          : null,
    });
  }),

  http.get('/api/v1/projects/:id', ({ params }) => {
    const row = findDemoProjectRow(String(params.id));
    const actor = getMockActor();
    if (!row || !canSeeProject(row, actor)) return notFound();
    // Формулы типа проекта (#632) — на чтении, поверх клонированного DTO.
    return HttpResponse.json(projectWithFormulas(detailOf(row, actor), row.typeId));
  }),

  http.get('/api/v1/projects/:id/members', ({ params }) => {
    const row = findDemoProjectRow(String(params.id));
    const actor = getMockActor();
    if (!row || !canSeeProject(row, actor)) return notFound();
    return HttpResponse.json({ items: demoProjectMembersFor(row.id), nextCursor: null });
  }),

  http.get('/api/v1/projects/:id/history', ({ params, request }) => {
    const row = findDemoProjectRow(String(params.id));
    const actor = getMockActor();
    if (!row || !canSeeProject(row, actor)) return notFound();
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 30);
    const cursor = url.searchParams.get('cursor');
    let events = demoProjectEvents
      .filter((event) => event.projectId === row.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    if (cursor) {
      try {
        const position = JSON.parse(cursor) as { at: string; id: string };
        events = events.filter(
          (event) =>
            event.createdAt < position.at ||
            (event.createdAt === position.at && event.id < position.id),
        );
      } catch {
        return HttpResponse.json(
          { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid cursor' },
          { status: 422 },
        );
      }
    }
    const page = events.slice(0, limit);
    const last = page[page.length - 1];
    return HttpResponse.json({
      items: page.map(historyEntryOf),
      nextCursor:
        events.length > limit && last ? JSON.stringify({ at: last.createdAt, id: last.id }) : null,
    });
  }),
];
