import type { TaskListItem, TaskStage, WorkflowTransition } from '@nodus/contracts';
import {
  effectiveWindowSections,
  ErrorCode,
  executeTransitionBodySchema,
  isFinalState,
  ui,
} from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import {
  autoMovePersonalPlacement,
  demoPersonalStages,
  demoSubtasks,
  demoTasks,
} from '../../../../shared/mocks/data/tasks.js';
import {
  demoWorkflowDetails,
  KOMPLEKT_WORKFLOW_ID,
  komplektType,
  quickDocument,
  standardDocument,
} from '../../../../shared/mocks/data/workflows.js';
import { quickProcessType } from '../../../../shared/mocks/data/task-stages.js';
import { applyDemoPatch } from '../../../../shared/mocks/data/custom-fields-rules.js';
import { counterRuleOf, issueMockNumber } from '../../../../shared/mocks/data/numbering-store.js';
import { applyForm, blockedByOf, checkWindow, postBlock } from './tasks-transitions-gates.js';

function findTask(id: string): TaskListItem | undefined {
  return (
    demoTasks.find((t) => t.id === id) ??
    Object.values(demoSubtasks)
      .flat()
      .find((t) => t.id === id)
  );
}

/** Маршрут задачи по её типу (#378): «Стандартный» или «Быстрый» —
 *  зеркало документов workflows.ts (каталог API). Условия «кто» в моке не
 *  проверяются (демо-пользователь — полный доступ), показ (`display`) и
 *  порядок — как у сервера: кнопки статуса по sortOrder, затем «из любого»;
 *  встроенное правило «итог → итог» прячет «Отменить» у закрытых. */
/** Маршрут «Комплекта» (#630): быстрый + кнопка «Выдать в печать». */
const komplektDocument = demoWorkflowDetails[KOMPLEKT_WORKFLOW_ID]!.document;

function documentOfTask(task: TaskListItem) {
  if (task.type.id === quickProcessType.id) return quickDocument;
  if (task.type.id === komplektType.id) return komplektDocument;
  return standardDocument;
}

function transitionsOf(task: TaskListItem): WorkflowTransition[] {
  const route = documentOfTask(task);
  const closed = isFinalState(task.stage.systemState);
  const stageIds = new Set(route.stages.map((s) => s.id));
  const own: WorkflowTransition[] = [];
  const anyFrom: WorkflowTransition[] = [];
  for (const t of route.transitions) {
    if (!stageIds.has(task.stage.id) || !stageIds.has(t.toStageId)) continue;
    if (t.fromStageId !== null && t.fromStageId !== task.stage.id) continue;
    if (t.fromStageId === null && closed) continue; // «итог → итог» скрыт
    // Само-петля без пост-действий — шум; с пост-действием («Выдать в
    // печать» #630) кнопка меняет запись, не меняя статус — показываем.
    if (t.toStageId === task.stage.id && t.rules.postFunctions.length === 0) continue;
    const target = stageDocOf(route, t.toStageId);
    const item: WorkflowTransition = {
      id: t.id,
      name: t.name,
      toStageId: t.toStageId,
      toStageName: target.name,
      toStageState: target.systemState,
      toStageOutcome: target.outcome,
      toStageColor: target.color,
      toStageOrder: target.sortOrder,
      display: t.display,
      intent: t.intent,
      blockedBy: blockedByOf(task, route, t.id),
      canOverride: true,
      form: t.form.enabled ? t.form : null,
      validators: t.rules.validators,
    };
    (t.fromStageId === null ? anyFrom : own).push(item);
  }
  own.sort((a, b) => orderOf(route, a.id) - orderOf(route, b.id));
  return [...own, ...anyFrom];
}

function stageDocOf(route: typeof standardDocument, id: string) {
  return route.stages.find((s) => s.id === id)!;
}

function orderOf(route: typeof standardDocument, transitionId: string): number {
  return route.transitions.find((t) => t.id === transitionId)?.sortOrder ?? 0;
}

/** Пост-эффект `route_if` («Завершить»): постановщик сам себе исполнитель —
 *  цель подменяется (утверждение пропускается, #378). */
function resolveTarget(task: TaskListItem, transition: WorkflowTransition): TaskStage {
  const route = documentOfTask(task);
  const doc = route.transitions.find((t) => t.id === transition.id);
  const routeIf = doc?.rules.postFunctions.find((p) => p.kind === 'route_if');
  if (
    routeIf &&
    routeIf.kind === 'route_if' &&
    task.creator.id === task.assignee?.id &&
    route.stages.some((s) => s.id === routeIf.toStageId)
  ) {
    const substituted = stageDocOf(route, routeIf.toStageId);
    return { ...substituted, order: substituted.sortOrder };
  }
  const target = stageDocOf(route, transition.toStageId);
  return { ...target, order: target.sortOrder };
}

export const tasksTransitionsHandlers = [
  http.get('/api/v1/tasks/:id/transitions', ({ params }) => {
    const task = findTask(String(params.id));
    if (!task)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Task not found' },
        { status: 404 },
      );
    return HttpResponse.json(transitionsOf(task));
  }),

  http.post('/api/v1/tasks/:id/transitions/:transitionId', async ({ params, request }) => {
    const task = findTask(String(params.id));
    const transition = task
      ? transitionsOf(task).find((t) => t.id === params.transitionId)
      : undefined;
    if (!task || !transition) {
      return HttpResponse.json(
        { code: ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED, message: 'Transition not allowed' },
        { status: 409 },
      );
    }
    const parsed = executeTransitionBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 400 },
      );
    }
    const sections = effectiveWindowSections(transition.form, {
      validators: transition.validators,
    });
    const check = checkWindow(sections, parsed.data.form ?? {});
    if (check.missing.length > 0 || check.unexpected.length > 0) {
      return HttpResponse.json(
        {
          code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
          message: ui.tasks.transitionNeedsWindow,
          details: { transitionId: transition.id, ...check },
        },
        { status: 422 },
      );
    }
    // Поля процесса (#431): проверка значений до применения окна.
    const customPatch = parsed.data.form?.fields?.customFields;
    if (customPatch) {
      const { issues } = applyDemoPatch(task.customFields, customPatch);
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
    }
    applyForm(task, parsed.data.form ?? {});
    const reasons = blockedByOf(task, documentOfTask(task), transition.id);
    if (reasons.length > 0 && !(parsed.data.override && parsed.data.reason?.trim())) {
      return HttpResponse.json(
        {
          code: ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
          message: 'Transition gates not passed',
          details: { reasons },
        },
        { status: 409 },
      );
    }
    postBlock(task, transition, parsed.data.form ?? {});
    // Пост-действие «Присвоить номер» (#630, Р4): номера счётчиков до смены
    // стадии; повторная выдача тому же полю — 409 (К5, номера не
    // переиспользуются). Разрез записи в моке — проект (папок в списке нет).
    const docTransition = documentOfTask(task).transitions.find((t) => t.id === transition.id);
    const assignFieldIds = (docTransition?.rules.postFunctions ?? [])
      .filter(
        (pf): pf is { kind: 'assign_number'; fieldId?: string } => pf.kind === 'assign_number',
      )
      .map((pf) => pf.fieldId)
      .filter((fieldId): fieldId is string => fieldId !== undefined);
    let assignedNumber: string | undefined;
    for (const fieldId of assignFieldIds) {
      const rule = counterRuleOf(fieldId);
      if (!rule) continue;
      if (task.customFields[fieldId] !== undefined) {
        return HttpResponse.json(
          {
            code: ErrorCode.NUMBER_ALREADY_ASSIGNED,
            message: 'Number is already assigned to this record',
          },
          { status: 409 },
        );
      }
      const scopePart =
        rule.scopeKind === 'none' ? null : (task.nodeId ?? task.project?.id ?? task.id);
      const display = issueMockNumber(fieldId, rule, scopePart);
      task.customFields[fieldId] = display;
      assignedNumber = assignedNumber ?? display;
    }
    task.stage = resolveTarget(task, transition);
    // Встроенное автоперемещение «Моего плана» (ADR-0008) — как у переноса
    // по глобальной оси.
    autoMovePersonalPlacement(task, demoPersonalStages);
    task.updatedAt = new Date().toISOString();
    // Контракт: строка задачи + НОВЫЕ кнопки нажавшего (одним ходом);
    // выданный номер — тосту и карточке (#630).
    return HttpResponse.json({
      task,
      transitions: transitionsOf(task),
      ...(assignedNumber ? { assignedNumber } : {}),
    });
  }),
];
