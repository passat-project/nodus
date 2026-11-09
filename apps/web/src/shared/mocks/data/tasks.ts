import type {
  ChatMessage,
  CustomFieldValues,
  TaskChainNode,
  TaskDetail,
  TaskListItem,
} from '@nodus/contracts';
import { isFinalState } from '@nodus/contracts';

import { demoTaskCustomFields } from './custom-fields.js';
import { demoRefsForValues } from './custom-fields-refs.js';
import { isoAgo } from './dates.js';
import { lid } from './letter-ids.js';
import { personalNew } from './personal-stages.js';
import { demoPlannedMinutes } from './task-item-factory.js';
import { pressOf } from './press.js';
import { demoTasks, kjSubtask, tid } from './task-items.js';
import { requestProcessType, stageNew, systemProcessType } from './task-stages.js';
import { layoutOf } from './task-layout.js';
import { fieldLocksDto } from './task-locks.js';
import { QUICK_WORKFLOW_ID, REQUEST_WORKFLOW_ID, STANDARD_WORKFLOW_ID } from './workflows.js';
import { quickProcessType } from './task-stages.js';
import { currentAuthUser, userIds, userRef } from './users.js';

export * from './task-stages.js';
export * from './personal-stages.js';
export * from './task-items.js';

/** Заполненные кастомные поля демо-задач (#431): у части задач есть
 *  значения, у остальных — `{}` (блок «Атрибуты» показывает «Не задано»).
 *  Ленивый геттер вместо присваивания на module-eval: мок-данные образуют
 *  цикл (tasks → custom-fields → project-nodes → tasks), на момент оценки
 *  этого модуля карта значений ещё не готова — читается при первом
 *  обращении обработчика, когда весь мир загружен. */
for (const task of demoTasks) {
  Object.defineProperty(task, 'customFields', {
    get: () => demoTaskCustomFields[task.id] ?? {},
    // Сеттер — часть того же ленивого стора: правка значений (PATCH задачи,
    // формула ячейки #632) пишет в demoTaskCustomFields, а не в элемент
    // списка. Без сеттера присваивание в строгом режиме бросало TypeError.
    set: (next: CustomFieldValues) => {
      demoTaskCustomFields[task.id] = next;
    },
    enumerable: true,
    configurable: true,
  });
}

export function makeSubtask(parent: TaskListItem, title: string): TaskListItem {
  return {
    id: crypto.randomUUID(),
    number: parent.number * 100 + ((demoSubtasks[parent.id]?.length ?? 0) + 1),
    title,
    type: systemProcessType,
    stage: stageNew,
    // Новая подзадача — в первую личную колонку состояния backlog (ADR-0008).
    personalStageId: personalNew.id,
    priority: 'normal',
    deadline: null,
    // Как API (POST /tasks/:id/subtasks = create с parentId): постановщик и
    // ответственный по умолчанию — актор, проект и узел структуры наследуются
    // от родителя (#467).
    creator: userRef(currentAuthUser.id),
    assignee: userRef(currentAuthUser.id),
    participants: [],
    project: parent.project,
    parentId: parent.id,
    nodeId: parent.nodeId,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    customFields: {},
    updatedAt: new Date().toISOString(),
  };
}

export const demoSubtasks: Record<string, TaskListItem[]> = {
  [tid(2)]: [kjSubtask],
};

/** Задачи-поручения из письма lid(3) («Замечания по разделу КЖ», Вх-2026/115):
 *  резолюция Р-57 породила три поручения разным людям (tid 5/12/13). Узлы
 *  «Резолюция»/«Поручение» — модель v2 цепочки (пересмотр в #463). */
const LETTER_ID_3 = lid(3);
const LETTER_3_NODE: TaskChainNode = {
  kind: 'letter',
  ref: 'Вх-2026/115',
  label: 'Замечания по разделу КЖ главного корпуса',
  entityId: LETTER_ID_3,
};
const RESOLUTION_57_NODE: TaskChainNode = {
  kind: 'resolution',
  ref: 'Р-57',
  label: 'Устранить замечания по КЖ, срок — до конца недели',
};

/** Префиксы доменных цепочек задач-поручений (Письмо → Резолюция → Поручение). */
const letterChainPrefix: Record<string, TaskChainNode[]> = {
  [tid(5)]: [
    LETTER_3_NODE,
    RESOLUTION_57_NODE,
    {
      kind: 'instruction',
      ref: 'ПП-57',
      label: 'Подготовить ответ заказчику по замечаниям, скорректировать комплект КЖ',
    },
  ],
  [tid(12)]: [
    LETTER_3_NODE,
    RESOLUTION_57_NODE,
    {
      kind: 'instruction',
      ref: 'ПП-58',
      label: 'Уточнить анкеровку арматуры в узлах КЖ-14 и КЖ-18',
    },
  ],
  [tid(13)]: [
    LETTER_3_NODE,
    RESOLUTION_57_NODE,
    { kind: 'instruction', ref: 'ПП-59', label: 'Проверить ведомость расхода стали по маркам' },
  ],
};

function chainOf(task: TaskListItem): TaskChainNode[] {
  const self: TaskChainNode = { kind: 'task', ref: `№ ${task.number}`, label: task.title };
  const letterPrefix = letterChainPrefix[task.id];
  if (letterPrefix) return [...letterPrefix, self];
  if (task.source === 'chat_message') {
    return [{ kind: 'chat_message', ref: 'Чат', label: 'Задача из сообщения' }, self];
  }
  return [self];
}

/** Детали задач поверх списочного элемента (описание, наблюдатели, чек-лист).
 *  Экспорт — хендлерам создания/чек-листа: записи пополняются в рантайме. */
export const detailsExtra: Record<
  string,
  Pick<TaskDetail, 'description' | 'observers' | 'checklist' | 'createdAt'> &
    Partial<Pick<TaskDetail, 'plannedMinutes' | 'acceptRequired' | 'result'>>
> = {
  [tid(2)]: {
    description:
      'Построить модель 3D по результатам лазерного сканирования: корпус Б, отметки 0.000–+6.000. Источник — облако точек в общем хранилище.',
    observers: [userRef(userIds.karpovich)],
    checklist: [
      { id: '50000000-0000-4000-8000-000000000001', text: 'Выгрузить облако точек', done: true },
      { id: '50000000-0000-4000-8000-000000000002', text: 'Каркас и колонны', done: false },
      { id: '50000000-0000-4000-8000-000000000003', text: 'Свести с разделом КЖ', done: false },
    ],
    createdAt: isoAgo(9),
  },
};

export function taskDetailOf(task: TaskListItem): TaskDetail {
  const extra = detailsExtra[task.id] ?? {
    description: 'Описание уточняется постановщиком.',
    observers: [],
    checklist: [],
    createdAt: task.updatedAt,
  };
  // completedAt — только у «Итога»: «Утверждение» не завершение (ADR-0020 доп. 2).
  const closed = isFinalState(task.stage.systemState);
  const customFields = task.customFields ?? {};
  return {
    ...task,
    ...extra,
    customFields,
    customFieldRefs: demoRefsForValues(customFields),
    subtasks: demoSubtasks[task.id] ?? [],
    chain: chainOf(task),
    workflowId:
      task.type.id === requestProcessType.id
        ? REQUEST_WORKFLOW_ID
        : task.type.id === quickProcessType.id
          ? QUICK_WORKFLOW_ID
          : STANDARD_WORKFLOW_ID,
    plannedMinutes: extra.plannedMinutes ?? demoPlannedMinutes[task.id] ?? null,
    acceptRequired: extra.acceptRequired ?? false,
    result: extra.result ?? null,
    press:
      pressOf(task.id, currentAuthUser.id)?.stageId === task.stage.id
        ? pressOf(task.id, currentAuthUser.id)
        : null,
    completedAt: closed ? task.updatedAt : null,
    // Состав карточки по типу (#432): блоки, названия ролей, обязательные поля.
    layout: layoutOf(task),
    fieldLocks: fieldLocksDto(task),
    // Мок-мир: демо-пользователь — полный доступ (права проверяет бэкенд, #37).
    access: {
      canEdit: true,
      canManageParticipants: true,
      canLogTime: true,
      canCheck: true,
      canDelete: true,
    },
  };
}

const mid = (n: number): string => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const demoTaskMessages: ChatMessage[] = [
  {
    id: mid(1),
    conversationId: tid(2),
    seq: 1,
    clientMessageId: `demo-task-1`,
    author: userRef(userIds.klevantovich),
    text: 'Облако точек выгрузил, качество хорошее. Берись за каркас.',
    replyToId: null,
    reply: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: isoAgo(2, 9, 12),
  },
  {
    id: mid(2),
    conversationId: tid(2),
    seq: 2,
    clientMessageId: `demo-task-2`,
    author: userRef(userIds.klimovich),
    text: 'Принял. К пятнице покажу колонны и балки.',
    replyToId: mid(1),
    reply: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [{ emoji: '👍', count: 1, mine: false, users: [userRef(userIds.matorin)] }],
    attachments: [],
    editedAt: null,
    readAt: isoAgo(2, 9, 41),
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: isoAgo(2, 9, 40),
  },
  {
    id: mid(3),
    conversationId: tid(2),
    seq: 3,
    clientMessageId: `demo-task-3`,
    author: userRef(userIds.karpovich),
    text: 'Подскажите, по осям 4–7 расхождения с КЖ, приложила скрин.',
    replyToId: null,
    reply: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [
      {
        id: '70000000-0000-4000-8000-000000000001',
        fileId: crypto.randomUUID(),
        name: 'расхождения_оси_4-7.pdf',
        size: 182_000,
        mime: 'application/pdf',
        kind: 'file',
        url: '/demo/sample.pdf',
        thumbnailUrl: null,
        previewKind: 'pdf',
        pdfUrl: null,
        width: null,
        height: null,
      },
    ],
    editedAt: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: isoAgo(1, 14, 5),
  },
];
