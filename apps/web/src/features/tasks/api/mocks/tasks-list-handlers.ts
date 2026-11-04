import type { TaskListItem, TaskStage } from '@nodus/contracts';
import { ErrorCode, createTaskBodySchema, isOpenState } from '@nodus/contracts';

import { http, HttpResponse } from 'msw';

import {
  demoPersonalStages,
  demoSubtasks,
  demoTasks,
  detailsExtra,
  firstPersonalStageOfState,
  globalStageForPersonal,
} from '../../../../shared/mocks/data/tasks.js';
import { demoProjects } from '../../../../shared/mocks/data/project-views.js';
import { findDemoNodeRow } from '../../../../shared/mocks/data/project-nodes.js';
import { demoStages } from '../../../../shared/mocks/data/task-stages.js';
import { demoProcessTypes, demoWorkflowDetails } from '../../../../shared/mocks/data/workflows.js';
import type { WorkflowDetail } from '@nodus/contracts';
import { userRef } from '../../../../shared/mocks/data/users.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { prepareCreateBody, resolveCreateType } from './task-create-policy.js';

function notFound(message: string) {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message }, { status: 404 });
}

/** workflowId живого типа (архивный каталог стадий не отдаёт). */
function workflowIdOfType(typeId: string): string | null {
  return demoProcessTypes.find((t) => t.id === typeId && !t.archivedAt)?.workflowId ?? null;
}
function typeNameOf(typeId: string): string | undefined {
  return demoProcessTypes.find((t) => t.id === typeId)?.name;
}
const archivedTypeIds = new Set(
  demoProcessTypes.filter((t) => t.archivedAt).map((t) => t.workflowId),
);

/** Мок-приближение к `TasksService.create`: API создаёт задачу в начальной
 *  стадии и в той же транзакции проводит переход в стадию колонки с проверкой
 *  условий и гейтов (#402); мок ставит стадию напрямую, без движка. */
function initialStageFor(stageId: string | undefined, column: TaskStage | undefined) {
  const starts = demoStages.filter((s) => isOpenState(s.systemState));
  const initial = starts[0];
  if (stageId) return starts.find((s) => s.id === stageId);
  if (column && isOpenState(column.systemState)) {
    return globalStageForPersonal(column, starts);
  }
  return initial;
}

/** Журнал/фиды колонок, каталог стадий со счётчиками и создание задачи. */
export const tasksListHandlers = [
  http.get('/api/v1/tasks', ({ request }) => {
    const url = new URL(request.url);
    const stageId = url.searchParams.get('stageId');
    const personalStageId = url.searchParams.get('personalStageId');
    const projectId = url.searchParams.get('projectId');
    const assigneeId = url.searchParams.get('assigneeId');
    const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100);
    let filtered = stageId ? demoTasks.filter((t) => t.stage.id === stageId) : demoTasks;
    if (personalStageId) {
      filtered = demoTasks.filter((t) => t.personalStageId === personalStageId);
    }
    if (projectId) {
      filtered = filtered.filter((t) => t.project?.id === projectId);
    }
    if (assigneeId) {
      filtered = filtered.filter((t) => t.assignee?.id === assigneeId);
    }
    if (search) {
      filtered = filtered.filter(
        (t) => t.title.toLowerCase().includes(search) || String(t.number).includes(search),
      );
    }
    const start = cursor ? Number(cursor) || 0 : 0;
    const items = filtered.slice(start, start + limit);
    const next = start + limit < filtered.length ? String(start + limit) : null;
    return HttpResponse.json({ items, nextCursor: next });
  }),

  // Межтиповой каталог стадий (#378): без typeId — статусы всех живых типов
  // с полями typeId/typeName; с typeId — статусы одного типа.
  http.get('/api/v1/tasks/stages', ({ request }) => {
    const typeId = new URL(request.url).searchParams.get('typeId');
    const sources = typeId
      ? [demoWorkflowDetails[workflowIdOfType(typeId) ?? '']]
      : Object.values(demoWorkflowDetails).filter((d) => !archivedTypeIds.has(d.id));
    const stages = (sources.filter(Boolean) as WorkflowDetail[]).flatMap((detail) =>
      detail.document.stages.map((s) => ({
        id: s.id,
        name: s.name,
        order: s.sortOrder,
        systemState: s.systemState,
        color: s.color,
        outcome: s.outcome,
        typeId: detail.typeIds[0],
        typeName: typeNameOf(detail.typeIds[0] ?? ''),
      })),
    );
    return HttpResponse.json(
      stages.map((s) => ({
        ...s,
        count: demoTasks.filter((t) => t.stage.id === s.id).length,
        overdueCount: demoTasks.filter(
          (t) =>
            t.stage.id === s.id &&
            t.deadline !== null &&
            new Date(t.deadline) < new Date() &&
            isOpenState(s.systemState),
        ).length,
      })),
    );
  }),

  /** Быстрое создание задачи из колонки доски (плюсик в шапке): личная
   *  колонка «Моего плана» — глобальная стадия подставляется по состоянию
   *  колонки; глобальная стадия (проектная доска) — как есть, личное
   *  размещение не создаётся (появится при первом DnD «Моего плана»).
   *  С #432 честно учитывает тип, приоритет, участников, план, родителя,
   *  источник и скрытые значения формы; политика — `task-create-policy`. */
  http.post('/api/v1/tasks', async ({ request }) => {
    const parsed = createTaskBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );
    // Тип и доступ к нему (Р6): 404 — неизвестный/архивный, 403 — закрыт.
    const typeResult = resolveCreateType(parsed.data.typeId);
    if (!typeResult.ok) {
      const { status, code, details } = typeResult.error;
      return HttpResponse.json(
        { code, message: code, ...(details ? { details } : {}) },
        { status },
      );
    }
    const type = typeResult.value;
    // Политика создания: пресеты, умолчания привязанных, обязательные поля.
    const policy = prepareCreateBody(type, parsed.data);
    if (!policy.ok) {
      const { status, code, details } = policy.error;
      return HttpResponse.json(
        { code, message: code, ...(details ? { details } : {}) },
        { status },
      );
    }
    const body = policy.value;
    const project = body.projectId ? demoProjects.find((p) => p.id === body.projectId) : undefined;
    const personalColumn = body.personalStageId
      ? demoPersonalStages.find((s) => s.id === body.personalStageId)
      : undefined;
    if (body.personalStageId && !personalColumn) return notFound('Stage not found');
    const stage = initialStageFor(body.stageId, personalColumn);
    if (!stage) return notFound('Stage not found');
    // Колонка — та, куда кликнули, если её состояние совпало со стадией
    // (закрытая колонка — задача встаёт в первую колонку начального
    // состояния, как placements.sync API).
    const personalStageId = personalColumn
      ? personalColumn.systemState === stage.systemState
        ? personalColumn.id
        : firstPersonalStageOfState(demoPersonalStages, stage.systemState).id
      : null;
    const checklist = (body.checklist ?? []).map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
    }));
    const actorId = getMockActor().id;
    // Ответственный: явный (пресет формы важнее — он уже в теле) или постановщик.
    const assignee = body.assigneeId ? userRef(body.assigneeId) : userRef(actorId);
    const participants = [
      ...(body.coexecutorIds ?? []).map((id) => userRef(id)),
      ...(body.observerIds ?? []).map((id) => userRef(id)),
    ].filter((ref) => ref.id !== assignee.id);
    const parent = body.parentId
      ? (demoTasks.find((t) => t.id === body.parentId) ?? findSubtask(body.parentId))
      : undefined;
    // Узел структуры (#467): должен существовать и принадлежать проекту.
    let nodeId: string | null = null;
    if (body.nodeId) {
      const node = findDemoNodeRow(body.nodeId);
      if (!node || node.projectId !== (body.projectId ?? null)) {
        return HttpResponse.json(
          { code: ErrorCode.PROJECT_NODE_INVALID, message: 'Node does not belong to project' },
          { status: 422 },
        );
      }
      nodeId = node.id;
    }
    const task: TaskListItem = {
      id: crypto.randomUUID(),
      number: Math.max(...demoTasks.map((t) => t.number)) + 1,
      title: body.title,
      type: {
        id: type.id,
        code: type.code,
        name: type.name,
        category: type.category,
        icon: type.icon,
        color: type.color,
      },
      stage,
      personalStageId,
      customFields: body.customFields ?? {},
      priority: body.priority ?? 'normal',
      deadline: body.deadline ?? null,
      creator: userRef(actorId),
      assignee,
      participants,
      project: project
        ? { id: project.id, code: project.code, name: project.name, color: project.color }
        : null,
      parentId: parent?.id ?? null,
      nodeId,
      spentMinutes: 0,
      plannedMinutes: body.plannedMinutes ?? null,
      commentsCount: 0,
      checklistDone: 0,
      checklistTotal: checklist.length,
      source: body.sourceMessageId ? 'chat_message' : 'manual',
      updatedAt: new Date().toISOString(),
    };
    demoTasks.push(task);
    // Деталь (описание/чек-лист/наблюдатели/план) — карточка видит их сразу.
    detailsExtra[task.id] = {
      description: body.description?.trim() ?? '',
      observers: (body.observerIds ?? []).map((id) => userRef(id)),
      checklist,
      plannedMinutes: body.plannedMinutes ?? null,
      createdAt: task.updatedAt,
    };
    return HttpResponse.json(task, { status: 201 });
  }),
];

/** Подзадача по id (дети живут в demoSubtasks). */
function findSubtask(id: string): TaskListItem | undefined {
  return Object.values(demoSubtasks)
    .flat()
    .find((t) => t.id === id);
}
