import type {
  FormulaMovePreviewResponse,
  Paginated,
  TaskBranch,
  TaskBranchNode,
  TaskListItem,
  TaskRelation,
} from '@nodus/contracts';
import { ErrorCode, taskUpdateBodySchema } from '@nodus/contracts';

import { http, HttpResponse } from 'msw';

import {
  autoMovePersonalPlacement,
  demoPersonalStages,
  demoSubtasks,
  demoTasks,
  detailsExtra,
  makeSubtask,
  taskDetailOf,
} from '../../../../shared/mocks/data/tasks.js';
import { demoStages } from '../../../../shared/mocks/data/task-stages.js';
import { findDemoNodeRow } from '../../../../shared/mocks/data/project-nodes.js';
import { userRef } from '../../../../shared/mocks/data/users.js';
import { applyDemoPatch } from '../../../../shared/mocks/data/custom-fields-rules.js';
import { lockedMockFieldIds } from '../../../../shared/custom-fields/formula/formula-mocks.js';
import { taskDetailWithFormulas } from '../../../../shared/custom-fields/formula/formula-dto.js';
import { checkClearedRequired, checkUnboundValues, typeOfTask } from './task-create-policy.js';
import { tasksChecklistHandlers } from './tasks-checklist-handlers.js';
import { tasksListHandlers } from './tasks-list-handlers.js';
import { tasksParticipantsHandlers } from './tasks-participants-handlers.js';
import { tasksPersonalStagesHandlers } from './tasks-personal-stages-handlers.js';
import { tasksTransitionsHandlers } from './tasks-transitions-handlers.js';
import { tasksWorkHandlers } from './tasks-work-handlers.js';

function notFound(message: string) {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message }, { status: 404 });
}

/** Дети узла ветки: общий список + свежесозданные подзадачи (demoSubtasks),
 *  дедуп по id (kjSubtask живёт в обоих). Порядок = порядок создания. */
function childrenOf(id: string): TaskListItem[] {
  const seen = new Set<string>();
  return [...demoTasks.filter((t) => t.parentId === id), ...(demoSubtasks[id] ?? [])].filter((t) =>
    seen.has(t.id) ? false : (seen.add(t.id), true),
  );
}

function branchNodeOf(task: TaskListItem): TaskBranchNode {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    hidden: false,
    stageName: task.stage.name,
    stageColor: task.stage.color,
    systemState: task.stage.systemState,
    children: childrenOf(task.id).map(branchNodeOf),
  };
}

/** MSW-маршруты домена задач — реестр домена (app/mocks-handlers.ts
 *  подключает только его): субдомены — своими файлами (журнал и создание,
 *  чек-лист, переходы, время/результат/bulk, личные колонки, участники),
 *  здесь — карточка задачи (деталь, ветка, связи, подзадачи, PATCH).
 *  Порядок важен: статические маршруты /tasks/<слово> — ДО /tasks/:id. */
export const tasksHandlers = [
  // Журнал/фиды, каталог стадий, создание — ДО '/api/v1/tasks/:id'
  // (:id захватил бы /tasks/stages).
  ...tasksListHandlers,

  /** Пункты чек-листа карточки (вердикт владельца 15.09.2026: чек-листу —
   *  важное место) — вынесены в tasks-checklist-handlers (I5). */
  ...tasksChecklistHandlers,
  // Кнопки маршрута карточки (ADR-0020).
  ...tasksTransitionsHandlers,
  // Типы, время/таймер, результат, bulk (#311) — ДО '/api/v1/tasks/:id'.
  ...tasksWorkHandlers,

  // Личная схема «Мой план» (ADR-0008): CRUD колонок — ДО '/api/v1/tasks/:id'
  // (:id захватил бы personal-stages).
  ...tasksPersonalStagesHandlers,

  http.get('/api/v1/tasks/:id', ({ params }) => {
    const task =
      demoTasks.find((t) => t.id === params.id) ??
      // Свежесозданные подзадачи живут в demoSubtasks (не в общем списке).
      Object.values(demoSubtasks)
        .flat()
        .find((t) => t.id === params.id);
    if (!task) return notFound('Task not found');
    // Формулы типа (#632) — поверх клонированного DTO, не в сторе задач.
    return HttpResponse.json(taskDetailWithFormulas(task));
  }),

  /** Ветка задачи для панели-навигатора: дерево от корневого предка. */
  http.get('/api/v1/tasks/:id/branch', ({ params }) => {
    let task = demoTasks.find((t) => t.id === params.id);
    if (!task) {
      // Свежесозданные подзадачи живут в demoSubtasks (не в общем списке).
      task = Object.values(demoSubtasks)
        .flat()
        .find((t) => t.id === params.id);
    }
    if (!task) return notFound('Task not found');
    let root = task;
    while (root.parentId) {
      const parent =
        demoTasks.find((t) => t.id === root.parentId) ??
        Object.values(demoSubtasks)
          .flat()
          .find((t) => t.id === root.parentId);
      if (!parent) break;
      root = parent;
    }
    return HttpResponse.json({ root: branchNodeOf(root) } satisfies TaskBranch);
  }),

  /** Связи задачи (поле «Отношения», вкладка «Связи» навигатора ветки) —
   *  заготовка под зависимости Ганта (#39): пока пусто, вкладка — Empty. */
  http.get('/api/v1/tasks/:id/relations', () =>
    HttpResponse.json({ items: [], nextCursor: null } satisfies Paginated<TaskRelation>),
  ),

  http.post('/api/v1/tasks/:id/subtasks', async ({ params, request }) => {
    const parent = demoTasks.find((t) => t.id === params.id);
    if (!parent) return notFound('Task not found');
    const { title } = (await request.json()) as { title: string };
    const subtask = makeSubtask(parent, title);
    (demoSubtasks[parent.id] ??= []).push(subtask);
    return HttpResponse.json(subtask, { status: 201 });
  }),

  /** Превью формульного диффа переноса задачи (#632, критерий 1): демо-мир
   *  без формульных переносов — дифф пуст, окно подтверждения не открывается. */
  http.post('/api/v1/tasks/:id/move-preview', ({ params }) => {
    const task =
      demoTasks.find((t) => t.id === params.id) ??
      Object.values(demoSubtasks)
        .flat()
        .find((t) => t.id === params.id);
    if (!task) return notFound('Task not found');
    return HttpResponse.json({ changes: [] } satisfies FormulaMovePreviewResponse);
  }),

  http.patch('/api/v1/tasks/:id', async ({ params, request }) => {
    const task = demoTasks.find((t) => t.id === params.id);
    if (!task) return notFound('Task not found');
    const parsed = taskUpdateBodySchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 422 },
      );

    // Правка полей без переноса (карточка: ответственный, срок, приоритет…).
    if (!parsed.data.stageId && !parsed.data.personalStageId) {
      const body = parsed.data;
      const type = typeOfTask(task.type.id);
      // Обязательное при создании поле нельзя очистить (#432, Р5) и значение
      // непривязанного к типу атрибута записать нельзя (Р8).
      const unbound = checkUnboundValues(type, body.customFields ?? {});
      if (!unbound.ok) {
        const { status, code, details } = unbound.error;
        return HttpResponse.json(
          { code, message: code, ...(details ? { details } : {}) },
          { status },
        );
      }
      const cleared = checkClearedRequired(type, {
        description: body.description,
        deadline: body.deadline,
        customFields: body.customFields ?? undefined,
      });
      if (!cleared.ok) {
        const { status, code, details } = cleared.error;
        return HttpResponse.json(
          { code, message: code, ...(details ? { details } : {}) },
          { status },
        );
      }
      if (body.assigneeId) {
        task.assignee = userRef(body.assigneeId);
        task.participants = task.participants.filter((p) => p.id !== body.assigneeId);
      }
      if (body.title !== undefined) task.title = body.title;
      if (body.priority !== undefined) task.priority = body.priority;
      if (body.deadline !== undefined) task.deadline = body.deadline;
      // Перенос в папку структуры (#467): PATCH несёт nodeId одиночного DnD,
      // null — «Без папки». Мок терял его, и перенос задачи в демо-мире не
      // менял ничего (сервер пишет nodeId — task-fields.writer.ts:147).
      if (body.nodeId !== undefined) {
        if (body.nodeId === null) {
          task.nodeId = null;
        } else {
          const node = findDemoNodeRow(body.nodeId);
          if (!node || node.projectId !== task.project?.id) {
            return HttpResponse.json(
              { code: ErrorCode.PROJECT_NODE_INVALID, message: 'Node is invalid' },
              { status: 422 },
            );
          }
          task.nodeId = node.id;
        }
      }
      const extra = (detailsExtra[task.id] ??= {
        description: taskDetailOf(task).description,
        observers: [],
        checklist: [],
        createdAt: task.updatedAt,
      });
      if (body.description !== undefined) extra.description = body.description;
      if (body.plannedMinutes !== undefined) extra.plannedMinutes = body.plannedMinutes;
      // Кастомные поля (#431): слияние по ключам, null удаляет; проверяются
      // только изменившиеся значения — правила те же, что у сервера (Р2).
      if (body.customFields) {
        const { next, issues } = applyDemoPatch(task.customFields, body.customFields);
        if (issues.length > 0) {
          return HttpResponse.json(
            {
              code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
              message: 'Custom field value is invalid',
              details: { issues },
            },
            { status: 422 },
          );
        }
        // Формульная ячейка руками не пишется (#660): значение в атрибут со
        // своей формулой или формулой типа — 422, как на реальном сервере.
        const changedMock = Object.keys(body.customFields).filter(
          (fieldId) => task.customFields?.[fieldId] !== next[fieldId],
        );
        const lockedMock = lockedMockFieldIds('task', task.id, changedMock);
        if (lockedMock.size > 0) {
          return HttpResponse.json(
            {
              code: 'FORMULA_CELL_LOCKED',
              message: 'Formula cell value is computed by its formula',
              details: { fields: [...lockedMock] },
            },
            { status: 422 },
          );
        }
        task.customFields = next;
      }
      task.updatedAt = new Date().toISOString();
      return HttpResponse.json(task);
    }
    // Перенос по личной оси («Мой план»): глобальная стадия не трогается.
    const columnId = parsed.data.personalStageId ?? parsed.data.stageId;
    const column = parsed.data.personalStageId
      ? demoPersonalStages.find((s) => s.id === columnId)
      : demoStages.find((s) => s.id === columnId);
    if (!column) return notFound('Stage not found');

    if (parsed.data.stageId) {
      task.stage = column;
      // Встроенное автоперемещение личной доски (ADR-0008): смена системного
      // состояния переезжает карточку в первую личную колонку этого состояния.
      autoMovePersonalPlacement(task, demoPersonalStages);
    } else {
      task.personalStageId = column.id;
    }
    task.updatedAt = new Date().toISOString();

    // Порядок внутри колонки persistится: переставляем в массиве, чтобы
    // refetch не «отщёлкивал» порядок после переноса.
    const sameColumn = (t: TaskListItem) =>
      parsed.data.personalStageId ? t.personalStageId === column.id : t.stage.id === column.id;
    const from = demoTasks.indexOf(task);
    demoTasks.splice(from, 1);
    const siblings = demoTasks.filter(sameColumn);
    const at = parsed.data.index;
    const anchor = at !== undefined ? siblings[at] : undefined;
    const last = siblings[siblings.length - 1];
    if (anchor) demoTasks.splice(demoTasks.indexOf(anchor), 0, task);
    else if (last) demoTasks.splice(demoTasks.indexOf(last) + 1, 0, task);
    else demoTasks.push(task);
    return HttpResponse.json(task);
  }),

  // Участники (соисполнители/наблюдатели).
  ...tasksParticipantsHandlers,
];
