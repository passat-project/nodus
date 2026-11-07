import { z } from 'zod';

import {
  customFieldValuesInputSchema,
  customFieldValuesPatchSchema,
  customFieldValuesSchema,
} from '../custom-fields/custom-field-values.js';
import { customFieldRefSchema } from '../custom-fields/custom-field-refs.js';
import { customFieldFormulasSchema } from '../custom-fields/formula-api.schemas.js';
import { userRefSchema } from '../directory/user-ref.schema.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';
import { projectRefSchema } from '../projects/project.schemas.js';
import { processTypeRefSchema } from '../workflows/process-type.schemas.js';
import { taskCardLayoutSchema } from '../workflows/process-type-config.js';
import { workflowTransitionSchema } from '../workflows/workflow.schemas.js';
import {
  stageColorSchema,
  stageOutcomeSchema,
  taskSystemStateSchema,
  type StageColor,
  type TaskSystemState,
} from '../workflows/workflow-primitives.schemas.js';

/**
 * Контракты модуля задач (tasks.Task). Системное состояние — скрытое (I15),
 * видимые стадии — из статус-схемы (WorkflowStage); в MVP — одна схема по умолчанию.
 */

// Примитивы палитры и состояний живут в workflow-primitives (общие для
// схем задач, типов и документов маршрута) — переэкспорт для потребителей.
export { stageColorSchema, taskSystemStateSchema };
export type { StageColor, TaskSystemState } from '../workflows/workflow-primitives.schemas.js';

export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskSourceSchema = z.enum(['manual', 'chat_message', 'letter']);
export type TaskSource = z.infer<typeof taskSourceSchema>;

/** Стадия workflow-схемы = колонка канбана (ADR-0008: схемы двух масштабов —
 *  проектная и личная «Мой план»; у личной та же форма + привязка к
 *  системному состоянию для встроенного автоперемещения). */
export const taskStageSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  order: z.number().int().min(0),
  systemState: taskSystemStateSchema,
  color: stageColorSchema,
  /** Итог этапа «Итог» (closed): выполнена/отменена — чип закрытой задачи
   *  (#378); у открытых стадий отсутствует. */
  outcome: stageOutcomeSchema.nullable().optional(),
  /** Тип-владелец стадии: межтиповой каталог GET /tasks/stages без typeId
   *  (#378); у запроса одного типа отсутствует. */
  typeId: z.uuid().optional(),
  typeName: z.string().min(1).optional(),
});

export type TaskStage = z.infer<typeof taskStageSchema>;

/** Стадия + счётчики колонки канбана (шапки и сводка страницы; totals в
 * list-ответах запрещены каноном api-conventions — счётчики живут в каталоге). */
export const taskStageWithCountSchema = taskStageSchema.extend({
  count: z.number().int().min(0),
  overdueCount: z.number().int().min(0),
});

export type TaskStageWithCount = z.infer<typeof taskStageWithCountSchema>;

/** Ссылка на задачу (для связей из других модулей — чат задачи и пр.). */
export const taskRefSchema = z.object({
  id: z.uuid(),
  number: z.number().int().min(1),
  title: z.string().min(1),
});

export type TaskRef = z.infer<typeof taskRefSchema>;

export const taskListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int().min(1),
  title: z.string().min(1),
  /** Тип процесса (ADR-0020/0024); категория задачи. */
  type: processTypeRefSchema,
  stage: taskStageSchema,
  /** Размещение на личной доске «Мой план» текущего пользователя
   *  (TaskPersonalPlacement, ADR-0008); null — ещё не раскладывалась. */
  personalStageId: z.uuid().nullable(),
  priority: taskPrioritySchema,
  deadline: z.iso.datetime().nullable(),
  creator: userRefSchema,
  assignee: userRefSchema.nullable(),
  /** Соисполнители (TaskParticipant role=coexecutor). */
  participants: z.array(userRefSchema),
  project: projectRefSchema.nullable(),
  /** Родительская задача (вложенность: граф уровней в списке). */
  parentId: z.uuid().nullable(),
  /** Узел структуры проекта (дерево #467, ADR-0030); null — вне структуры
   *  (секция «Без узла»). Меняется только в дереве проекта, не в карточке. */
  nodeId: z.uuid().nullable(),
  /** Трудозатраты суммарно, минуты (I14). */
  spentMinutes: z.number().int().min(0),
  /** Плановое время задачи, минуты; null — не задано. Своё значение задачи,
   *  не агрегат поддерева (агрегаты узлов — `ProjectNodeRollup`). */
  plannedMinutes: z.number().int().min(0).nullable(),
  commentsCount: z.number().int().min(0),
  checklistDone: z.number().int().min(0),
  checklistTotal: z.number().int().min(0),
  source: taskSourceSchema,
  /** Значения кастомных полей по id определения (#431, ADR-0029). */
  customFields: customFieldValuesSchema,
  /** Ссылки для показа значений в списках (#632, Р9): строки списков несут
   *  имена/цвета, чтобы атрибутные колонки показывали список/ссылку без
   *  запроса детали. Производное — старые моки могут не присылать. */
  customFieldRefs: z.array(customFieldRefSchema).optional(),
  /** Формульные ячейки (#632): своя формула/формула типа и ошибка. Поле
   *  производное — старые моки/клиенты могут его не присылать (пусто =
   *  формул нет). */
  customFieldFormulas: customFieldFormulasSchema.optional(),
  updatedAt: z.iso.datetime(),
});

export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const checklistItemSchema = z.object({
  id: z.uuid(),
  text: z.string().min(1),
  done: z.boolean(),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/** Узел доменной цепочки сущности (Письмо → Резолюция → Поручение → Задача). */
export const taskChainNodeSchema = z.object({
  kind: z.enum(['letter', 'resolution', 'instruction', 'task', 'chat_message']),
  /** Человекочитаемый ключ узла (Вх-2026/118, ПП-57, № 105). */
  ref: z.string().min(1),
  /** Короткое содержание узла. */
  label: z.string().min(1),
  /** Статус узла, если есть («Согласовано»). */
  state: z.string().optional(),
  /** Сущность для перехода по клику (письмо, чат). */
  entityId: z.uuid().optional(),
});

export type TaskChainNode = z.infer<typeof taskChainNodeSchema>;

/** Что текущий пользователь может делать с задачей (сервер — истина, I8;
 *  UI прячет недоступные действия). */
export const taskAccessSchema = z.object({
  /** Правка полей (название, описание, срок, приоритет, план). */
  canEdit: z.boolean(),
  /** Смена ответственного, соисполнителей и наблюдателей. */
  canManageParticipants: z.boolean(),
  /** Запись времени и таймер. */
  canLogTime: z.boolean(),
  /** Отметка пунктов чек-листа (соисполнители — тоже). */
  canCheck: z.boolean(),
  canDelete: z.boolean(),
});
export type TaskAccess = z.infer<typeof taskAccessSchema>;

/** Ревизия результата задачи (append-only; текущий результат — последняя). */
export const taskResultSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  /** Закреплённые сообщения чата задачи как часть результата. */
  messageIds: z.array(z.uuid()),
  author: userRefSchema,
  createdAt: z.iso.datetime(),
});
export type TaskResult = z.infer<typeof taskResultSchema>;

export const taskResultCreateBodySchema = z.object({
  text: z.string().trim().max(5000),
  messageIds: z.array(z.uuid()).max(50).optional(),
});
export type TaskResultCreateBody = z.infer<typeof taskResultCreateBodySchema>;

export const taskDetailSchema = taskListItemSchema.extend({
  description: z.string(),
  observers: z.array(userRefSchema),
  checklist: z.array(checklistItemSchema),
  subtasks: z.array(taskListItemSchema),
  /** Доменная цепочка происхождения; последний узел — текущая задача. */
  chain: z.array(taskChainNodeSchema),
  /** Маршрут типа задачи — «Схема маршрута» в карточке (#378). */
  workflowId: z.uuid(),
  /** УСТАРЕВШЕЕ (#378): утверждение — статус маршрута, флаг не используется;
   *  поле в выдаче живёт до контракта #383 (колонка в БД остаётся). */
  acceptRequired: z.boolean(),
  result: taskResultSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
  access: taskAccessSchema,
  /** Ссылки для показа значений кастомных полей (Р6): имя/аватар/архив. */
  customFieldRefs: z.array(customFieldRefSchema),
  /** Состав карточки по типу (#432): скрытые блоки, названия ролей и
   *  обязательные при создании поля. Собирает сервер — работает и для типа,
   *  невидимого зрителю. */
  layout: taskCardLayoutSchema,
  createdAt: z.iso.datetime(),
});

export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const createSubtaskBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeId: z.uuid().optional(),
  deadline: z.iso.datetime().optional(),
  /** Узел структуры (#467): без явного значения подзадача наследует узел
   *  родителя — отдельного шага выбора узла в окне подзадачи нет. */
  nodeId: z.uuid().optional(),
});

export type CreateSubtaskBody = z.infer<typeof createSubtaskBodySchema>;

/** Создание задачи: из колонки доски (плюсик в шапке — название + колонка
 *  одной из осей), из ЭКСПРЕСС-ФОРМЫ (вердикт владельца 15.09.2026, модель
 *  Битрикс24) и из сообщения чата («В задачу»: source + sourceId). Колонка
 *  не обязательна: без неё задача встаёт в начальную стадию маршрута своего
 *  типа (задача без проекта и доски — обычный случай). projectId —
 *  необязательная привязка к проекту. */
export const createTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  personalStageId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  /** Узел структуры проекта («+ задача» на узле дерева, #467): задача
   *  создаётся сразу в узле (валидация принадлежности проекту — read-порт). */
  nodeId: z.uuid().optional(),
  /** Тип задачи; по умолчанию — системный «Задача». */
  typeId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  /** Экспресс-форма (все поля опциональны — канбан-плюсик их не шлёт). */
  description: z.string().trim().max(5000).optional(),
  /** Ответственный; по умолчанию — постановщик. */
  assigneeId: z.uuid().optional(),
  coexecutorIds: z.array(z.uuid()).max(50).optional(),
  observerIds: z.array(z.uuid()).max(50).optional(),
  priority: taskPrioritySchema.optional(),
  deadline: z.iso.datetime().optional(),
  plannedMinutes: z.number().int().min(1).max(100_000).optional(),
  /** Пункты чек-листа текстами; на детали задачи разворачиваются в
   *  ChecklistItem[]. */
  checklist: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  /** Происхождение «В задачу» из сообщения чата: id сообщения (дедуп —
   *  одна задача на сообщение). Поручения из писем создаёт обработчик
   *  события корреспонденции, не клиент. */
  sourceMessageId: z.uuid().optional(),
  /** Значения кастомных полей области задачи; умолчания подставляет сервер. */
  customFields: customFieldValuesInputSchema.optional(),
});

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;

/** Добавление пункта чек-листа в карточке задачи. */
export const checklistItemCreateBodySchema = z.object({
  text: z.string().trim().min(1).max(300),
});

export type ChecklistItemCreateBody = z.infer<typeof checklistItemCreateBodySchema>;

/** Обновление пункта чек-листа (отметка выполнения / правка текста /
 *  перестановка: index — новая позиция в списке). */
export const checklistItemUpdateBodySchema = z
  .object({
    done: z.boolean().optional(),
    text: z.string().trim().min(1).max(300).optional(),
    index: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type ChecklistItemUpdateBody = z.infer<typeof checklistItemUpdateBodySchema>;

/** DTO обновления задачи. Перенос между стадиями (канбан, drag-and-drop) —
 *  глобальной оси (stageId: попытка ПЕРЕХОДА маршрута — нет перехода или не
 *  пройден гейт → 409 WORKFLOW_TRANSITION_NOT_ALLOWED / WORKFLOW_TRANSITION_BLOCKED)
 *  или личной (personalStageId, «Мой план»: колонка другого системного
 *  состояния = переход в стадию этого состояния). index — позиция внутри
 *  целевой колонки (порядок persistится). Поля карточки — правка (права:
 *  постановщик, ответственный, task.manage_any). null — очистить поле. */
export const taskUpdateBodySchema = z
  .object({
    stageId: z.uuid().optional(),
    personalStageId: z.uuid().optional(),
    index: z.number().int().min(0).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    priority: taskPrioritySchema.optional(),
    deadline: z.iso.datetime().nullable().optional(),
    plannedMinutes: z.number().int().min(1).max(100_000).nullable().optional(),
    assigneeId: z.uuid().optional(),
    parentId: z.uuid().nullable().optional(),
    /** Перенос задачи в другой проект (или из проекта — null; #52): сервер
     *  проверяет видимость проекта актёру, состав секретного и архивность. */
    projectId: z.uuid().nullable().optional(),
    /** Перенос задачи в узел структуры проекта (или из структуры — null;
     *  #467): узел обязан принадлежать проекту задачи; смена projectId
     *  обнуляет узел. Поля «Узел» в карточке нет — перенос живёт в дереве. */
    nodeId: z.uuid().nullable().optional(),
    /** Патч значений кастомных полей: `null` — очистить поле (#431). */
    customFields: customFieldValuesPatchSchema.optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'index'), { message: 'empty update' });

export type TaskUpdateBody = z.infer<typeof taskUpdateBodySchema>;

/** Ответ кнопки маршрута: строка задачи + НОВЫЕ кнопки нажавшего (панель
 *  процесса обновляется одним ходом, без повторного GET /transitions). */
export const executeTransitionResultSchema = z.object({
  task: taskListItemSchema,
  transitions: z.array(workflowTransitionSchema),
  /** Номер, выданный пост-действием «Присвоить номер» (#630, Р4): тост
   *  «Присвоен номер …» и оптимистичный патч counter-поля. Отсутствует у
   *  переходов без выдачи. */
  assignedNumber: z.string().min(1).optional(),
});

export type ExecuteTransitionResult = z.infer<typeof executeTransitionResultSchema>;

/** `POST /tasks/:id/type` — смена типа задачи. Если текущего статуса нет в
 *  новом маршруте — обязателен `stageId` (куда встать; подсказка дефолта —
 *  первый живой статус того же этапа, иначе начальный). Тип чужой категории
 *  (письмо) сервер отвергает: 404 — сущность другого модуля. */
export const changeTaskTypeBodySchema = z.object({
  typeId: z.uuid(),
  stageId: z.uuid().optional(),
});
export type ChangeTaskTypeBody = z.infer<typeof changeTaskTypeBodySchema>;

/** CRUD личных стадий «Моего плана» (личная схема пользователя, ADR-0008).
 *  Удаление — DELETE /tasks/personal-stages/:id (последняя запрещена — 409);
 *  задачи удаляемой колонки переезжают в первую колонку того же состояния. */
export const personalStageCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: stageColorSchema,
  systemState: taskSystemStateSchema,
});

export type PersonalStageCreateBody = z.infer<typeof personalStageCreateBodySchema>;

export const personalStageUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: stageColorSchema.optional(),
    systemState: taskSystemStateSchema.optional(),
    order: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export type PersonalStageUpdateBody = z.infer<typeof personalStageUpdateBodySchema>;

/** Ветка задачи для панели-навигатора: дерево от корневого предка,
 *  вложенность любой глубины; текущая задача резолвится на клиенте по id.
 *  Узел, который зрителю не виден (`hidden`), раскрывает только номер:
 *  ни названия, ни стадии (#343, канон владельца 19.10: не участник —
 *  задачу не видит). */
export interface TaskBranchNode {
  id: string;
  number: number;
  title: string;
  hidden: boolean;
  stageName: string | null;
  stageColor: StageColor | null;
  systemState: TaskSystemState | null;
  children: TaskBranchNode[];
}

export const taskBranchNodeSchema: z.ZodType<TaskBranchNode> = z.lazy(() =>
  z.object({
    id: z.uuid(),
    number: z.number().int().min(1),
    title: z.string().min(1),
    hidden: z.boolean(),
    stageName: z.string().min(1).nullable(),
    stageColor: stageColorSchema.nullable(),
    systemState: taskSystemStateSchema.nullable(),
    children: z.array(taskBranchNodeSchema),
  }),
);

export const taskBranchSchema = z.object({ root: taskBranchNodeSchema });
export type TaskBranch = z.infer<typeof taskBranchSchema>;

/** Связь задачи (поле «Отношения», вкладка «Связи» навигатора ветки):
 *  relates — связана, blocks — блокирует, precedes — предшествует
 *  (finish-to-start, задел «порядка» ступени 2), duplicates — дублирует. */
export const taskRelationKindSchema = z.enum(['relates', 'blocks', 'precedes', 'duplicates']);
export type TaskRelationKind = z.infer<typeof taskRelationKindSchema>;

export const taskRelationSchema = z.object({
  id: z.uuid(),
  kind: taskRelationKindSchema,
  /** Связанная задача (на другом конце связи). */
  task: taskRefSchema,
  /** out — связь из этой задачи; in — из связанной в эту. */
  direction: z.enum(['out', 'in']),
});
export type TaskRelation = z.infer<typeof taskRelationSchema>;

export const taskRelationCreateBodySchema = z.object({
  toTaskId: z.uuid(),
  kind: taskRelationKindSchema,
});
export type TaskRelationCreateBody = z.infer<typeof taskRelationCreateBodySchema>;

export const listTasksQuerySchema = cursorQuerySchema.extend({
  /** mine — задачи, где я постановщик/ответственный/соисполнитель/наблюдатель;
   *  all — всё, что мне видно (подчинённые по оргструктуре, task.view_all). */
  scope: z.enum(['mine', 'all']).default('mine'),
  /** Уточнение «моих» по роли («делаю», «поручил», «помогаю», «наблюдаю»);
   *  `decider` — задачи, где я держатель шага (#433), серверный фильтр. */
  role: z.enum(['assignee', 'creator', 'coexecutor', 'observer', 'decider']).optional(),
  /** Только просроченные (deadline < now, состояние ∉ done/closed). */
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Подзадачи родителя. */
  parentId: z.uuid().optional(),
  typeId: z.uuid().optional(),
  view: z.enum(['list', 'kanban']).default('kanban'),
  search: z.string().trim().min(1).max(128).optional(),
  /** Фид колонки канбана: курсорная подгрузка порциями (industry-паттерн:
   *  колонки держат тысячи карточек, целиком не отдаются). */
  stageId: z.uuid().optional(),
  /** Фид колонки личной доски «Мой план» (по TaskPersonalPlacement). */
  personalStageId: z.uuid().optional(),
  /** Задачи проекта (список/канбан в карточке проекта). */
  projectId: z.uuid().optional(),
  /** Задачи исполнителя (вкладка «Задачи» карточки сотрудника). */
  assigneeId: z.uuid().optional(),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
