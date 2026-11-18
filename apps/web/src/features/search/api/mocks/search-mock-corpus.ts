import type { ConversationListItem, LetterDirection, SearchSourceType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { demoConversations, demoMessages } from '../../../../shared/mocks/data/chat.js';
import { demoLetters } from '../../../../shared/mocks/data/letters.js';
import { canSeeLetter } from '../../../../shared/mocks/data/letters-model.js';
import { canSeeProject } from '../../../../shared/mocks/data/project-views.js';
import { demoProjectRows } from '../../../../shared/mocks/data/projects.js';
import { demoTasks } from '../../../../shared/mocks/data/tasks.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import type { MockActor } from '../../../../shared/mocks/mock-actor.js';

/**
 * Мок-мир поиска (#952, P1): проекция пяти источников из демо-данных.
 * Видимость — функциями модулей (письма: `canSeeLetter`, проекты:
 * `canSeeProject`, сотрудники: активные), чтобы демо-приёмка «вторым
 * сотрудником» не показывала чужих писем. Ранжирование и правила ответа —
 * `search-mock.ts`.
 */
export interface MockDocument {
  type: SearchSourceType;
  id: string;
  title: string;
  body: string;
  keywords: string;
  identifiers: string[];
  projectId: string | null;
  projectName: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  authorId: string | null;
  authorName: string | null;
  participantIds: string[];
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  taskNumber?: number | null;
  regNumber?: string | null;
  direction?: LetterDirection;
  status?: string;
  code?: string | null;
  positionName?: string | null;
  departmentName?: string | null;
  email?: string | null;
  conversation?: ConversationListItem;
  seq?: number;
  threadRootId?: string | null;
}

/** Полураспад свежести: сообщения гаснут быстрее задач и писем (#952 Р7). */
export const HALF_LIFE_DAYS: Record<SearchSourceType, number | null> = {
  message: 7,
  task: 30,
  letter: 30,
  project: 90,
  employee: null,
};

const EMPLOYEE_CREATED_AT = '2024-01-01T00:00:00.000Z';

function taskDocs(): MockDocument[] {
  return demoTasks.map((task) => {
    const participants = new Set([task.creator.id, task.assignee?.id].filter(Boolean) as string[]);
    for (const participant of task.participants) participants.add(participant.id);
    return {
      type: 'task',
      id: task.id,
      title: task.title,
      body: '',
      keywords: `ПП-${task.number}`,
      identifiers: [String(task.number), `ПП-${task.number}`],
      projectId: task.project?.id ?? null,
      projectName: task.project?.name ?? null,
      counterpartyId: null,
      counterpartyName: null,
      authorId: task.creator.id,
      authorName: task.creator.displayName,
      participantIds: [...participants],
      // В TaskListItem нет createdAt: дата правки — приближение мока.
      sourceCreatedAt: task.updatedAt,
      sourceUpdatedAt: task.updatedAt,
      taskNumber: task.number,
    };
  });
}

function letterDocs(actor: MockActor): MockDocument[] {
  return (
    demoLetters
      // «Новые» тоже индексируются: их видит держатель права регистрации
      // (canSeeLetter покрывает и это, и конфиденциальность).
      .filter((letter) => canSeeLetter(letter, actor))
      .map((letter) => {
        const attachments = letter.attachments.map((attachment) => attachment.name);
        const attachedNumbers = letter.attachedRefs.map((ref) => ref.number);
        const participants = new Set([
          letter.registrar?.id,
          letter.addressee?.id,
          ...letter.participantIds,
        ]);
        return {
          type: 'letter',
          id: letter.id,
          title: [letter.regNumber, letter.subject].filter(Boolean).join(' '),
          body: [letter.theirNumber, ...attachedNumbers, ...attachments].filter(Boolean).join(' '),
          keywords: letter.direction === 'incoming' ? 'входящее' : 'исходящее',
          identifiers: [letter.regNumber, letter.theirNumber].filter(
            (value): value is string => typeof value === 'string' && value !== '',
          ),
          projectId: letter.project?.id ?? null,
          projectName: letter.project?.name ?? null,
          counterpartyId: letter.counterparty?.id ?? null,
          counterpartyName: letter.counterparty?.name ?? null,
          authorId: letter.registrar?.id ?? letter.createdById,
          authorName: letter.registrar?.displayName ?? null,
          participantIds: [...participants].filter((id): id is string => typeof id === 'string'),
          sourceCreatedAt: letter.receivedAt,
          sourceUpdatedAt: letter.receivedAt,
          regNumber: letter.regNumber,
          direction: letter.direction,
        };
      })
  );
}

function projectDocs(actor: MockActor): MockDocument[] {
  return demoProjectRows
    .filter((row) => row.archivedAt === null && canSeeProject(row, actor))
    .map((row) => ({
      type: 'project',
      id: row.id,
      title: row.name,
      body: row.description,
      keywords: row.code ?? '',
      identifiers: row.code ? [row.code] : [],
      projectId: row.id,
      projectName: row.name,
      counterpartyId: null,
      counterpartyName: null,
      authorId: row.creatorId,
      authorName: null,
      participantIds: [],
      sourceCreatedAt: row.createdAt,
      sourceUpdatedAt: row.updatedAt,
      status: row.status,
      code: row.code,
    }));
}

function employeeDocs(): MockDocument[] {
  return demoUserListItems
    .filter((user) => user.status === 'active')
    .map((user) => ({
      type: 'employee',
      id: user.id,
      title: user.displayName,
      body: [user.positionName, user.departmentName, user.email].filter(Boolean).join(' '),
      keywords: '',
      identifiers: [],
      projectId: null,
      projectName: null,
      counterpartyId: null,
      counterpartyName: null,
      authorId: user.id,
      authorName: user.displayName,
      participantIds: [],
      sourceCreatedAt: EMPLOYEE_CREATED_AT,
      sourceUpdatedAt: EMPLOYEE_CREATED_AT,
      positionName: user.positionName,
      departmentName: user.departmentName,
      email: user.email,
    }));
}

export function conversationLabel(conversation: ConversationListItem): string {
  if (conversation.type === 'task' && conversation.task) {
    return `${ui.search.messageInTaskChat} ПП-${conversation.task.number}`;
  }
  if (conversation.type === 'letter' && conversation.letter) {
    return `${ui.search.messageInLetterChat} ${conversation.letter.regNumber ?? ''}`.trim();
  }
  return (
    conversation.title ??
    conversation.membersPreview.map((member) => member.displayName).join(', ') ??
    ui.search.title
  );
}

function messageDocs(): MockDocument[] {
  const byId = new Map(demoConversations.map((conversation) => [conversation.id, conversation]));
  const docs: MockDocument[] = [];
  for (const message of demoMessages) {
    const conversation = byId.get(message.conversationId);
    if (!conversation || message.deletedAt !== null) continue;
    const attachments = message.attachments.map((attachment) => attachment.name);
    const body = [message.text, ...attachments].filter(Boolean).join(' ');
    if (body.trim() === '') continue;
    docs.push({
      type: 'message',
      id: message.id,
      title: '',
      body,
      keywords: '',
      identifiers: [],
      projectId: null,
      projectName: null,
      counterpartyId: null,
      counterpartyName: null,
      authorId: message.author.id,
      authorName: message.author.displayName,
      participantIds: [],
      sourceCreatedAt: message.createdAt,
      sourceUpdatedAt: message.editedAt ?? message.createdAt,
      conversation,
      seq: message.seq,
      threadRootId: message.threadRootId,
    });
  }
  return docs;
}

/** Проекция мок-мира для актёра (видимость писем/проектов/сотрудников). */
export function mockSearchDocuments(actor: MockActor): MockDocument[] {
  return [
    ...taskDocs(),
    ...letterDocs(actor),
    ...messageDocs(),
    ...projectDocs(actor),
    ...employeeDocs(),
  ];
}
