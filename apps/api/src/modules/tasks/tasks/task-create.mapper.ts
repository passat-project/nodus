import type { CreateTaskBody } from '@nodus/contracts';

import { audienceIds } from '../access/task-access.js';
import type { CatalogStage } from '../../workflows/ports/process-catalog-reader.port.js';
import type { TasksRepository } from './tasks.repository.js';

/** Строка задачи, созданная репозиторием (payload события создания). */
export type CreatedTaskRow = Awaited<ReturnType<TasksRepository['create']>>;

/** Данные строки создания (первый аргумент TasksRepository.create). */
export type TaskCreateData = Parameters<TasksRepository['create']>[0];

/**
 * Сборка создания задачи из тела запроса: строки участников, данные строки
 * БД и payload события `task.created`. Вынесено из TasksService.create
 * ради лимита строк файла (I5); отображения прежние, дословно.
 */

/** Строки участников: ответственный и постановщик ролей не дублируют;
 *  соисполнитель сильнее наблюдателя. */
export function participantRows(body: CreateTaskBody, creatorId: string, assigneeId: string) {
  const skip = new Set([assigneeId]);
  const rows = new Map<string, 'coexecutor' | 'observer'>();
  for (const uid of body.observerIds ?? [])
    if (!skip.has(uid) && uid !== creatorId) rows.set(uid, 'observer');
  for (const uid of body.coexecutorIds ?? []) if (!skip.has(uid)) rows.set(uid, 'coexecutor');
  return [...rows].map(([userId, role]) => ({ userId, role, muted: role === 'observer' }));
}

/** Данные строки новой задачи (стадию и порядок стадии передаёт сервис). */
export function taskCreateData(
  body: CreateTaskBody,
  args: {
    typeId: string;
    workflowId: string;
    initial: Pick<CatalogStage, 'id' | 'systemState'>;
    stageOrder: TaskCreateData['stageOrder'];
    creatorId: string;
    assigneeId: string;
    participants: TaskCreateData['participants'];
    customFields: TaskCreateData['customFields'];
  },
): TaskCreateData {
  return {
    title: body.title,
    description: body.description ?? '',
    typeId: args.typeId,
    workflowId: args.workflowId,
    stageId: args.initial.id,
    systemState: args.initial.systemState,
    stageOrder: args.stageOrder,
    priority: body.priority ?? 'normal',
    deadline: body.deadline ? new Date(body.deadline) : null,
    plannedMinutes: body.plannedMinutes ?? null,
    // Утверждение — статус маршрута (#378); поле БД живёт до #383.
    acceptRequired: false,
    creatorId: args.creatorId,
    assigneeId: args.assigneeId,
    parentId: body.parentId ?? null,
    projectId: body.projectId ?? null,
    nodeId: body.nodeId ?? null,
    source: body.sourceMessageId ? 'chat_message' : 'manual',
    sourceId: body.sourceMessageId ?? null,
    checklistTotal: body.checklist?.length ?? 0,
    participants: args.participants,
    customFields: args.customFields,
  };
}

/** Payload события `task.created` (аудитория — по создателю/отвественному/участникам). */
export function taskCreatedPayload(
  task: Pick<
    CreatedTaskRow,
    'id' | 'number' | 'title' | 'projectId' | 'parentId' | 'nodeId' | 'source' | 'sourceId'
  >,
  args: { creatorId: string; assigneeId: string; participants: ReturnType<typeof participantRows> },
) {
  return {
    taskId: task.id,
    number: task.number,
    audience: audienceIds({
      creatorId: args.creatorId,
      assigneeId: args.assigneeId,
      participants: args.participants,
    }),
    title: task.title,
    creatorId: args.creatorId,
    assigneeId: args.assigneeId,
    coexecutorIds: args.participants.filter((p) => p.role === 'coexecutor').map((p) => p.userId),
    observerIds: args.participants.filter((p) => p.role === 'observer').map((p) => p.userId),
    projectId: task.projectId,
    parentId: task.parentId,
    nodeId: task.nodeId,
    source: task.source,
    sourceId: task.sourceId,
  };
}
