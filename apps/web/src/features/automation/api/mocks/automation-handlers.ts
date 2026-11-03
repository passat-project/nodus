import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  checkWorkflowDocument,
  hasBlockingProblems,
  publishWorkflowBodySchema,
  saveWorkflowLayoutBodySchema,
} from '@nodus/contracts';

import { demoSubtasks, demoTasks } from '../../../../shared/mocks/data/tasks.js';
import { mockWorkflows } from '../../../../shared/mocks/data/workflows-store.js';
import { resolvePublishedDocument } from './publish-resolve.js';
import { documentFacts, typeDto } from '../../../../shared/mocks/data/process-types-dto.js';
import { mockTypes, nextId } from '../../../../shared/mocks/data/process-types-store.js';
import {
  automationTypeHandlers,
  isLockedLetterType,
  letterCatalogLocked,
} from './automation-type-handlers.js';

/** Моки «Автоматизации» (#378; форма создания — #432): чтение и публикация
 *  маршрутов (проверки, конфликт версий, переносы), расстановка холста и
 *  смена типа задачи. Библиотека типов — `automation-type-handlers`. */

const invalid = (status: number, code: keyof typeof ErrorCode, details?: unknown) =>
  HttpResponse.json({ code: ErrorCode[code], message: code, details }, { status });
const validationFailed = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Not found' }, { status: 404 });

function findTask(id: unknown) {
  return (
    demoTasks.find((t) => t.id === id) ??
    Object.values(demoSubtasks)
      .flat()
      .find((t) => t.id === id)
  );
}

export const automationHandlers = [
  ...automationTypeHandlers,

  http.get('/api/v1/workflows/:id', ({ params }) => {
    const detail = mockWorkflows.get(String(params.id));
    return detail ? HttpResponse.json(structuredClone(detail)) : notFound();
  }),

  http.post('/api/v1/workflows/:id/publish', async ({ request, params }) => {
    const detail = mockWorkflows.get(String(params.id));
    if (!detail) return notFound();
    if (isLockedLetterType(mockTypes.find((entry) => entry.workflowId === detail.id))) {
      return letterCatalogLocked();
    }
    const parsed = publishWorkflowBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const { baseVersion, document, migrations } = parsed.data;

    if (baseVersion !== detail.version) {
      return invalid(409, 'WORKFLOW_VERSION_CONFLICT');
    }
    // Тип-владелец маршрута: его привязки атрибутов и категория (Р8, #432).
    const type = mockTypes.find((entry) => entry.workflowId === detail.id);
    const problems = checkWorkflowDocument(document, documentFacts(type, type?.category ?? 'task'));
    if (hasBlockingProblems(problems)) {
      return invalid(422, 'WORKFLOW_INVALID', { problems });
    }
    // Архивируемые стадии с задачами требуют переноса (мок считает по
    // счётчикам документа; перенос «выполняется» мгновенно).
    const archivedWithTasks = detail.document.stages
      .filter((old) => !document.stages.some((s) => s.id === old.id))
      .map((old) => ({ stageId: old.id, count: detail.stageEntityCounts[old.id] ?? 0 }))
      .filter((row) => row.count > 0);
    if (archivedWithTasks.length > 0) {
      const covered = new Set(migrations.map((m) => m.fromStageId));
      const missing = archivedWithTasks.filter((row) => !covered.has(row.stageId));
      if (missing.length > 0) {
        return invalid(422, 'WORKFLOW_MIGRATION_REQUIRED', { stages: missing });
      }
    }

    const scheduledMoves = archivedWithTasks.reduce((sum, row) => sum + row.count, 0);
    const resolved = resolvePublishedDocument(document, migrations, nextId);
    // Счётчики: оставшиеся статусы сохраняют задачи, цели переносов — получают.
    const counts = Object.fromEntries(
      resolved.document.stages.map((s) => [s.id, detail.stageEntityCounts[s.id] ?? 0]),
    );
    for (const m of resolved.migrations) {
      counts[m.toStageId] =
        (counts[m.toStageId] ?? 0) + (detail.stageEntityCounts[m.fromStageId] ?? 0);
    }
    detail.document = resolved.document;
    detail.version += 1;
    detail.publishedAt = new Date().toISOString();
    detail.stageEntityCounts = counts;
    return HttpResponse.json({
      version: detail.version,
      publishedAt: detail.publishedAt,
      scheduledMoves,
    });
  }),

  // Расстановка холста — без новой версии; слияние по элементам, только
  // живые статусы и кнопки (как на сервере).
  http.put('/api/v1/workflows/:id/layout', async ({ request, params }) => {
    const detail = mockWorkflows.get(String(params.id));
    if (!detail) return notFound();
    if (isLockedLetterType(mockTypes.find((entry) => entry.workflowId === detail.id))) {
      return letterCatalogLocked();
    }
    const parsed = saveWorkflowLayoutBodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed();
    const current = detail.document.layout ?? { stages: {}, transitions: {} };
    const stageIds = new Set(detail.document.stages.map((s) => s.id));
    const transitionIds = new Set(detail.document.transitions.map((t) => t.id));
    const merged = {
      stages: Object.fromEntries(
        Object.entries({ ...current.stages, ...parsed.data.layout.stages }).filter(([id]) =>
          stageIds.has(id),
        ),
      ),
      transitions: Object.fromEntries(
        Object.entries({ ...current.transitions, ...parsed.data.layout.transitions }).filter(
          ([id]) => transitionIds.has(id),
        ),
      ),
    };
    detail.document = { ...detail.document, layout: merged };
    return HttpResponse.json({ layout: merged });
  }),

  // --- Смена типа задачи ----------------------------------------------------

  http.post('/api/v1/tasks/:id/type', async ({ request, params }) => {
    const body = (await request.json()) as { typeId?: string; stageId?: string };
    const task = findTask(params.id);
    const type = mockTypes.find((t) => t.id === body.typeId);
    if (!task || !type) return notFound();
    // Доступ к целевому типу (Р6): невидимый или неразрешённый — 403.
    const viewer = typeDto(type).viewer;
    if (!viewer.canCreate) {
      return invalid(403, 'PROCESS_TYPE_FORBIDDEN', {
        typeId: type.id,
        reason: viewer.canView ? 'not_creatable' : 'view',
      });
    }
    const detail = mockWorkflows.get(type.workflowId);
    if (!detail) return notFound();
    // Как сервер: тот же статус есть в новом маршруте — остаётся; иначе
    // stageId обязателен (422 WORKFLOW_MIGRATION_REQUIRED).
    const stages = detail.document.stages;
    const stageDoc =
      stages.find((s) => s.id === task.stage.id) ?? stages.find((s) => s.id === body.stageId);
    if (!stageDoc) {
      return HttpResponse.json(
        { code: ErrorCode.WORKFLOW_MIGRATION_REQUIRED, message: 'stageId is required' },
        { status: 422 },
      );
    }
    task.type = {
      id: type.id,
      code: type.code,
      name: type.name,
      category: type.category,
      icon: type.icon,
      color: type.color,
    };
    task.stage = {
      id: stageDoc.id,
      name: stageDoc.name,
      order: stageDoc.sortOrder,
      systemState: stageDoc.systemState,
      color: stageDoc.color,
    };
    // Контракт POST /tasks/:id/type — строка задачи (TaskListItem).
    return HttpResponse.json(task);
  }),
];
