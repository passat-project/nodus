import type {
  EffectiveSection,
  TaskListItem,
  TransitionBlockReason,
  TransitionFormInput,
  WorkflowTransition,
} from '@nodus/contracts';
import {
  isFinalState,
  lockFieldFilled,
  lockKeysOfPatch,
  windowWritableKeys,
} from '@nodus/contracts';

import { demoConversations, demoMessages } from '../../../../shared/mocks/data/chat.js';
import { applyDemoPatch } from '../../../../shared/mocks/data/custom-fields-rules.js';
import { demoSubtasks, detailsExtra, taskDetailOf } from '../../../../shared/mocks/data/tasks.js';
import { userRef } from '../../../../shared/mocks/data/users.js';
import { lockDenial } from '../../../../shared/mocks/data/task-locks.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import type { standardDocument } from '../../../../shared/mocks/data/workflows.js';

/** Гейты, окно и запись блока перехода в мок-мире (#380): та же грамматика,
 *  что у сервера (ADR-0020) — демо на `:5173` и веб-тесты видят поведение. */

/** Живые вложения сообщений (файлы итога — вложения чата задачи, #252). */
export function fileCount(messageIds: readonly string[]): number {
  const ids = new Set(messageIds);
  return demoMessages
    .filter((m) => ids.has(m.id) && !m.deletedAt)
    .reduce(
      (sum, m) => sum + m.attachments.filter((a) => a.kind === 'image' || a.kind === 'file').length,
      0,
    );
}

export function fieldFilled(task: TaskListItem, field: string): boolean {
  const detail = taskDetailOf(task);
  // Грамматика заполненности — общая с сервером (#496, Р4, В10).
  return lockFieldFilled(field, {
    description: detail.description,
    deadline: task.deadline,
    assigneeId: task.assignee?.id ?? null,
    plannedMinutes: detail.plannedMinutes,
    hasResult: Boolean(detail.result?.text.trim()),
    customFields: task.customFields,
  });
}

/** Гейты мока — та же грамматика, что у сервера (ADR-0020). */
export function blockedByOf(
  task: TaskListItem,
  route: typeof standardDocument,
  transitionId: string,
): TransitionBlockReason[] {
  const doc = route.transitions.find((t) => t.id === transitionId);
  if (!doc) return [];
  const reasons: TransitionBlockReason[] = [];
  for (const validator of doc.rules.validators) {
    switch (validator.kind) {
      case 'no_open_subtasks': {
        const count = (demoSubtasks[task.id] ?? []).filter(
          (s) => !isFinalState(s.stage.systemState),
        ).length;
        if (count > 0) reasons.push({ kind: validator.kind, count });
        break;
      }
      case 'checklist_complete':
        if (taskDetailOf(task).checklist.some((item) => !item.done)) {
          reasons.push({ kind: validator.kind });
        }
        break;
      case 'fields_required': {
        const fields = validator.fields.filter((f) => !fieldFilled(task, f));
        if (fields.length > 0) reasons.push({ kind: validator.kind, fields });
        break;
      }
      case 'time_logged':
        if (task.spentMinutes <= 0) reasons.push({ kind: validator.kind });
        break;
      case 'result_present':
        if (!taskDetailOf(task).result?.text.trim()) reasons.push({ kind: validator.kind });
        break;
      case 'result_files': {
        const count = fileCount(taskDetailOf(task).result?.messageIds ?? []);
        if (count < validator.min) {
          reasons.push({ kind: validator.kind, count, min: validator.min });
        }
        break;
      }
    }
  }
  return reasons;
}

/** Сверка введённого с эффективным окном (как сервер, §9). */
export function checkWindow(
  sections: readonly EffectiveSection[],
  input: TransitionFormInput,
): { missing: string[]; unexpected: string[] } {
  const allowed = new Set<string>();
  const missing: string[] = [];
  for (const section of sections) {
    switch (section.kind) {
      case 'fields':
        for (const field of section.fields) allowed.add(`fields.${field}`);
        break;
      case 'time':
        allowed.add('time');
        break;
      case 'result':
      case 'result_files':
        allowed.add('result');
        break;
      case 'result_messages':
        allowed.add('result');
        if (section.required && (input.result?.messageIds.length ?? 0) === 0) {
          missing.push('result_messages');
        }
        break;
      case 'comment':
        allowed.add('comment');
        if (section.required && !input.comment?.trim()) missing.push('comment');
        break;
    }
  }
  const unexpected: string[] = [];
  if (input.fields) {
    const map: Record<string, string> = {
      description: 'description',
      deadline: 'deadline',
      plannedMinutes: 'plannedMinutes',
      assigneeId: 'assignee',
    };
    for (const key of Object.keys(input.fields)) {
      if (key === 'customFields') {
        // Поля процесса (#431): каждый ключ — в своём разрешённом поле.
        for (const fieldId of Object.keys(input.fields.customFields ?? {})) {
          if (!allowed.has(`fields.cf.${fieldId}`)) {
            unexpected.push(`fields.customFields.${fieldId}`);
          }
        }
        continue;
      }
      if (!allowed.has(`fields.${map[key] ?? key}`)) unexpected.push(`fields.${key}`);
    }
  }
  if (input.time && !allowed.has('time')) unexpected.push('time');
  if (input.result && !allowed.has('result')) unexpected.push('result');
  if (input.comment && !allowed.has('comment')) unexpected.push('comment');
  return { missing, unexpected };
}

/** Применение окна к мок-задаче: поля, время, ревизия итога. */
export function applyForm(task: TaskListItem, input: TransitionFormInput): void {
  const actor = getMockActor();
  const extra = (detailsExtra[task.id] ??= {
    description: taskDetailOf(task).description,
    observers: [],
    checklist: [],
    createdAt: task.updatedAt,
  });
  if (input.fields?.description !== undefined) extra.description = input.fields.description;
  if (input.fields?.plannedMinutes !== undefined) {
    extra.plannedMinutes = input.fields.plannedMinutes;
  }
  if (input.fields?.deadline !== undefined) task.deadline = input.fields.deadline;
  if (input.fields?.assigneeId !== undefined) task.assignee = userRef(input.fields.assigneeId);
  if (input.fields?.customFields) {
    const { next } = applyDemoPatch(task.customFields, input.fields.customFields);
    task.customFields = next;
  }
  if (input.time) task.spentMinutes += input.time.minutes;
  if (input.result) {
    extra.result = {
      id: crypto.randomUUID(),
      text: input.result.text,
      messageIds: input.result.messageIds,
      author: userRef(actor.id),
      createdAt: new Date().toISOString(),
    };
  }
}

/** Блок перехода в мок-ленте задачи (#380): причина/итог окна, автор — нажавший. */
export function postBlock(
  task: TaskListItem,
  transition: WorkflowTransition,
  input: TransitionFormInput,
): void {
  const conversation = demoConversations.find((c) => c.task?.id === task.id);
  if (!conversation || (!input.comment && !input.result)) return;
  const recordId = crypto.randomUUID();
  const actor = getMockActor();
  const seq = Math.max(0, ...demoMessages.map((m) => m.seq)) + 1;
  demoMessages.push({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    seq,
    clientMessageId: `task-transition:${recordId}`,
    author: userRef(actor.id),
    text: input.comment ?? '',
    kind: 'task_transition',
    block: {
      kind: 'task_transition',
      taskId: task.id,
      recordId,
      transitionName: transition.name.slice(0, 32),
      fromStageName: task.stage.name.slice(0, 40),
      toStageName: transition.toStageName.slice(0, 40),
      commentLabel: transition.form?.sections.find((s) => s.kind === 'comment')?.label ?? null,
      result: input.result
        ? {
            fileCount: fileCount(input.result.messageIds),
            messageCount: input.result.messageIds.length,
          }
        : null,
    },
    replyToId: null,
    reply: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: new Date().toISOString(),
  });
  conversation.lastMessage = demoMessages[demoMessages.length - 1] ?? null;
}

/** Блок действия без смены статуса в мок-ленте задачи (#633): автор —
 *  нажавший, статус не меняется, причина — текст окна. */
export function postActionBlock(
  task: TaskListItem,
  action: { name: string; form: WorkflowTransition['form'] },
  input: TransitionFormInput,
): void {
  const conversation = demoConversations.find((c) => c.task?.id === task.id);
  if (!conversation) return;
  const recordId = crypto.randomUUID();
  const actor = getMockActor();
  const seq = Math.max(0, ...demoMessages.map((m) => m.seq)) + 1;
  demoMessages.push({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    seq,
    clientMessageId: `task-action:${recordId}`,
    author: userRef(actor.id),
    text: input.comment ?? '',
    kind: 'task_action',
    block: {
      kind: 'task_action',
      taskId: task.id,
      recordId,
      actionName: action.name.slice(0, 40),
      stageName: task.stage.name.slice(0, 40),
      commentLabel: action.form?.sections.find((s) => s.kind === 'comment')?.label ?? null,
      result: input.result
        ? {
            fileCount: fileCount(input.result.messageIds),
            messageCount: input.result.messageIds.length,
          }
        : null,
    },
    replyToId: null,
    reply: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: new Date().toISOString(),
  });
  conversation.lastMessage = demoMessages[demoMessages.length - 1] ?? null;
}

/** Запись окна в закреплённое (#496, Р4, В10): ключи настроенного раздела
 *  окно пишет мимо замка; ключ, который добавило только условие «Заполнены
 *  поля», — пока он пуст. Грамматика — общая с сервером (`windowWritableKeys`
 *  контрактов); остальное закреплённое — 422 FIELD_LOCKED. */
export function windowLockDenial(
  task: TaskListItem,
  sections: readonly EffectiveSection[],
  input: TransitionFormInput,
): Response | null {
  if (!input.fields) return null;
  const writable = windowWritableKeys(sections, (key) => fieldFilled(task, key));
  return lockDenial(task, lockKeysOfPatch(input.fields), undefined, writable);
}
