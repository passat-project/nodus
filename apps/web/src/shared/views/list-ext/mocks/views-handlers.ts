import { http, HttpResponse } from 'msw';
import type {
  CreateSavedViewBody,
  FolderListItem,
  ListExportStatus,
  SavedView,
  UpdateSavedViewBody,
} from '@nodus/contracts';
import { ErrorCode, createSavedViewBodySchema, updateSavedViewBodySchema } from '@nodus/contracts';

import { getMockActor } from '../../../mocks/mock-actor.js';
import { applyMockExt } from './mock-list-ext.js';

/**
 * Мок-сервер /views (#435): сохранённые настройки списков и выгрузка CSV.
 * Хранилище — память воркера (сбрасывается перезагрузкой страницы — демо).
 * Права приближены: личные видит владелец, проектные — все, кто видит проект
 * (демо-мир не различает руководство для чтения — запись на живом сервере
 * отдаст 403 не-руководству). Выгрузка: до 1000 строк — done сразу (файл
 * генерируется из демо-строк), больше — queued (статусы: running → done);
 * для тестов фоновой ветки — принудительная очередь `forceMockExportQueue`.
 */

interface StoredView extends SavedView {
  ownerId: string;
}

const store = new Map<string, StoredView>();
const exports = new Map<string, { status: ListExportStatus }>();
const files = new Map<string, string>();

/** Тестовый шов: всегда фоновая очередь (проверка поллинга без 1000 строк). */
let alwaysQueue = false;
export function forceMockExportQueue(value: boolean): void {
  alwaysQueue = value;
}

function dto(view: StoredView): SavedView {
  return {
    id: view.id,
    name: view.name,
    entity: view.entity,
    scope: view.scope,
    level: view.level,
    filter: view.filter,
    sort: view.sort,
    group: view.group,
    totals: view.totals,
    columns: view.columns,
    createdAt: view.createdAt,
    createdBy: view.createdBy,
  };
}

function badRequest(code: ErrorCode, status: number, details?: unknown) {
  return HttpResponse.json({ code, message: code, ...(details ? { details } : {}) }, { status });
}

async function rowsOfExport(entity: 'task' | 'letter' | 'folder'): Promise<{
  items: FolderListItem[];
  valueOf: (row: FolderListItem, field: string) => string | number | null;
}> {
  // Демо-строки выгрузки: папки — лёгкий локальный посев (импорт демо-
  // структуры тянет весь демо-мир циклом module-eval), задачи/письма —
  // пусто (их генерируют свои домены; для CSV-мока важен конвейер).
  if (entity === 'folder') {
    const folders: FolderListItem[] = (
      [
        ['1', 'Стадия П'],
        ['2', 'Комплект КЖ-01'],
        ['3', 'Раздел АР'],
      ] as [string, string][]
    ).map(([n, name]) => ({
      id: `f0000000-0000-4000-8000-00000000000${n}`,
      projectId: 'p0000000-0000-4000-8000-000000000001',
      parentId: null,
      kindId: `k0000000-0000-4000-8000-00000000000${n}`,
      name,
      code: null,
      customFields: {},
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    return { items: folders, valueOf: folderListValue };
  }
  return { items: [], valueOf: () => null };
}

/** Сырое значение поля строки папки (движок мока). */
function folderListValue(row: FolderListItem, field: string): string | number | null {
  switch (field) {
    case 'name':
      return row.name;
    case 'kind':
      return row.kindId;
    case 'createdAt':
      return row.createdAt;
    default:
      return (row.customFields as Record<string, unknown> | undefined)?.[field] != null
        ? String((row.customFields as Record<string, unknown>)[field])
        : null;
  }
}

export const viewsHandlers = [
  http.get('/api/v1/views', ({ request }) => {
    const url = new URL(request.url);
    const actor = getMockActor();
    const journal = url.searchParams.get('journal');
    const projectId = url.searchParams.get('projectId');
    const typeId = url.searchParams.get('typeId');
    const entity = url.searchParams.get('entity') as 'task' | 'letter' | 'folder' | null;
    const all = [...store.values()];
    let views: StoredView[];
    if (projectId) {
      views = all.filter(
        (view) =>
          view.scope.kind === 'project' &&
          view.scope.projectId === projectId &&
          (view.level !== 'personal' || view.ownerId === actor.id),
      );
    } else if (typeId) {
      views = all.filter(
        (view) => view.scope.kind === 'type_default' && view.scope.typeId === typeId,
      );
    } else if (journal === 'true') {
      views = all.filter(
        (view) =>
          view.scope.kind === 'journal' && view.ownerId === actor.id && view.level === 'personal',
      );
    } else {
      return badRequest(ErrorCode.VALIDATION_FAILED, 400);
    }
    const filtered = entity ? views.filter((view) => view.entity === entity) : views;
    const rank = (view: StoredView) =>
      view.level === 'project' ? 0 : view.level === 'type_default' ? 1 : 2;
    return HttpResponse.json(
      filtered.sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt)).map(dto),
    );
  }),

  http.post('/api/v1/views', async ({ request }) => {
    const parsed = createSavedViewBodySchema.safeParse(await request.json());
    if (!parsed.success) return badRequest(ErrorCode.VALIDATION_FAILED, 422);
    const body = parsed.data as CreateSavedViewBody;
    const level =
      body.scope.kind === 'journal'
        ? 'personal'
        : body.scope.kind === 'type_default'
          ? 'type_default'
          : (body.level ?? 'personal');
    if (body.level !== undefined && body.level !== level) {
      return badRequest(ErrorCode.VALIDATION_FAILED, 422, { scope: body.scope.kind, level });
    }
    const actor = getMockActor();
    const now = new Date().toISOString();
    const view: StoredView = {
      id: crypto.randomUUID(),
      name: body.name,
      entity: body.entity,
      scope: body.scope,
      level,
      filter: body.filter,
      sort: body.sort,
      group: body.group,
      totals: body.totals,
      columns: body.columns,
      createdAt: now,
      createdBy: actor.id,
      ownerId: actor.id,
    };
    store.set(view.id, view);
    return HttpResponse.json(dto(view), { status: 201 });
  }),

  http.patch('/api/v1/views/:id', async ({ params, request }) => {
    const view = store.get(String(params.id));
    if (!view) return badRequest(ErrorCode.NOT_FOUND, 404);
    const parsed = updateSavedViewBodySchema.safeParse(await request.json());
    if (!parsed.success) return badRequest(ErrorCode.VALIDATION_FAILED, 422);
    const patch = parsed.data as UpdateSavedViewBody;
    const actor = getMockActor();
    if (view.level === 'personal' && view.ownerId !== actor.id)
      return badRequest(ErrorCode.NOT_FOUND, 404);
    Object.assign(view, patch);
    return HttpResponse.json(dto(view));
  }),

  http.delete('/api/v1/views/:id', ({ params }) => {
    const view = store.get(String(params.id));
    if (!view) return badRequest(ErrorCode.NOT_FOUND, 404);
    const actor = getMockActor();
    if (view.level === 'personal' && view.ownerId !== actor.id)
      return badRequest(ErrorCode.NOT_FOUND, 404);
    store.delete(view.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/views/export', async ({ request }) => {
    const body = (await request.json()) as CreateSavedViewBody;
    const source = await rowsOfExport(body.entity);
    const ext = applyMockExt<FolderListItem>({
      rows: source.items,
      filter: body.filter,
      sort: body.sort,
      group: undefined,
      totals: [],
      entity: body.entity,
      valueOf: source.valueOf,
      definitions: [],
    });
    const rows = ext.items;
    const fileId = crypto.randomUUID();
    files.set(fileId, csvOf(body, rows, source.valueOf));
    if (!alwaysQueue && rows.length <= 1000) {
      return HttpResponse.json({
        status: 'done',
        fileId,
        url: `/api/v1/files/${fileId}/content?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${'0'.repeat(64)}`,
      });
    }
    const exportId = crypto.randomUUID();
    exports.set(exportId, { status: { status: 'running' } });
    setTimeout(() => {
      exports.set(exportId, {
        status: {
          status: 'done',
          fileId,
          url: `/api/v1/files/${fileId}/content?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${'0'.repeat(64)}`,
        },
      });
    }, 50);
    return HttpResponse.json({ status: 'queued', exportId });
  }),

  http.get('/api/v1/views/export/:id', ({ params }) => {
    const entry = exports.get(String(params.id));
    if (!entry) return badRequest(ErrorCode.NOT_FOUND, 404);
    return HttpResponse.json(entry.status);
  }),

  http.get('/api/v1/files/:id/content', ({ params }) => {
    const content = files.get(String(params.id));
    if (content === undefined) return badRequest(ErrorCode.NOT_FOUND, 404);
    return new HttpResponse(content, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="export.csv"',
      },
    });
  }),
];

/** Простейший CSV мока: заголовки колонок + значения (демо-приближение). */
function csvOf(
  body: CreateSavedViewBody,
  rows: readonly FolderListItem[],
  valueOf: (row: FolderListItem, field: string) => string | number | null,
): string {
  const header = body.columns.map((column) => column.field).join(';');
  const lines = rows.map((row) =>
    body.columns.map((column) => String(valueOf(row, column.field) ?? '')).join(';'),
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}
