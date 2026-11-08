import { z } from 'zod';

import { Permission } from '../auth/permission.js';
import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import {
  CUSTOM_FIELD_LIMITS,
  customFieldValueSchema,
} from '../custom-fields/custom-field-values.js';
import { deciderSourceSchema } from './decider.js';
import type { ProcessCategory } from './process-type.schemas.js';
import { transitionFormInputSchema, transitionFormSchema } from './transition-form.schemas.js';
import {
  docIdSchema,
  stageColorSchema,
  stageOutcomeSchema,
  taskSystemStateSchema,
  transitionDisplaySchema,
  workflowTransitionIntentSchema,
} from './workflow-primitives.schemas.js';

/**
 * Движок маршрутов «Процессов» (ADR-0020/ADR-0024): глобальный тип → маршрут
 * (стадии + переходы с правилами) через схему «тип → маршрут». Реестр видов
 * правил ЗАКРЫТ: новый вид = расширение union + обработчик в сервисе; сервер
 * отвергает неизвестный вид при чтении (правило в данных без исполнителя в
 * коде — ложная безопасность). Типы процессов — `process-type.schemas.ts`;
 * документ редактора — `workflow-document.schemas.ts`.
 */

const PERMISSION_VALUES = Object.values(Permission) as [Permission, ...Permission[]];

/** Роль пользователя относительно сущности процесса (вход условий переходов
 *  и прав). Словарь ролей задаёт адаптер категории (ADR-0024): у задачи —
 *  постановщик/ответственный/соисполнитель/наблюдатель, у письма —
 *  регистратор/адресат/исполнитель/расписавший/автор/участник (#55, Р6);
 *  движок ролей не знает, сравнивает с условиями маршрута. Какие роли
 *  допустимы в маршруте категории — `WORKFLOW_ROLES_BY_CATEGORY`. */
export const workflowActorRoleSchema = z.enum([
  'creator',
  'assignee',
  'coexecutor',
  'observer',
  'registrar',
  'addressee',
  'executor',
  'resolver',
  'author',
  'participant',
]);
export type WorkflowActorRole = z.infer<typeof workflowActorRoleSchema>;

/** Словарь ролей по категории типа (Р6): редактор предлагает только свои
 *  роли, проверка документа ловит чужие (`role_not_in_category`). У письма
 *  в #55 адаптер знает регистратора, адресата, участника и автора;
 *  исполнитель и расписавший наполнятся в #463. */
export const WORKFLOW_ROLES_BY_CATEGORY = {
  task: ['creator', 'assignee', 'coexecutor', 'observer'],
  letter: ['registrar', 'addressee', 'executor', 'resolver', 'author', 'participant'],
} as const satisfies Record<ProcessCategory, readonly WorkflowActorRole[]>;

/** Поля сущности, которые могут требовать гейты `fields_required` (DoR/DoD).
 *  Реестр полей — словарь категории: адаптер отдаёт заполненность по имени. */
export const workflowRequirableFieldSchema = z.enum([
  'description',
  'deadline',
  'assignee',
  'plannedMinutes',
  'result',
]);
export type WorkflowRequirableField = z.infer<typeof workflowRequirableFieldSchema>;

/** Ключ поля гейта «Заполнены поля»: системное поле или кастомное `cf.<uuid>`
 *  (#431, Р7). Union — надмножество: старые документы остаются валидными. */
export const workflowFieldKeySchema = z.union([
  workflowRequirableFieldSchema,
  customFieldKeySchema,
]);
export type WorkflowFieldKey = z.infer<typeof workflowFieldKeySchema>;

/** Условия — КТО видит и может нажать кнопку перехода. Пустой список —
 *  любой, кто может править сущность. Несколько условий — ИЛИ. */
export const workflowConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('role_in'), roles: z.array(workflowActorRoleSchema).min(1) }),
  // Только право из каталога (`auth/permission.ts`): опечатка или выдуманное
  // право сделало бы кнопку невидимой всем (security-ревью #378).
  z.object({ kind: z.literal('permission'), permission: z.enum(PERMISSION_VALUES) }),
  // Решающий вне задачи (#433): должность, руководитель автора/исполнителя,
  // сотрудники, поле «Сотрудник(и)», роль в проекте. Одно условие — один
  // источник; несколько источников = «любой из» (условия уже ИЛИ).
  z.object({ kind: z.literal('decider_in'), source: deciderSourceSchema }),
]);
export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

/** Валидаторы — гейты DoR/DoD: все должны пройти (И). */
export const workflowValidatorSchema = z.discriminatedUnion('kind', [
  /** Нет незавершённых подзадач. Строго (по умолчанию) мешают подзадачи и
   *  в работе, и на утверждении; `allowReview` — подзадачи на утверждении
   *  не мешают (ADR-0020, дополнение 2). Нет ключа = строго (редактор
   *  пишет только `true`). */
  z.object({ kind: z.literal('no_open_subtasks'), allowReview: z.boolean().optional() }),
  z.object({ kind: z.literal('checklist_complete') }),
  z.object({
    kind: z.literal('fields_required'),
    fields: z.array(workflowFieldKeySchema).min(1).max(CUSTOM_FIELD_LIMITS.gateFields),
  }),
  z.object({ kind: z.literal('time_logged') }),
  z.object({ kind: z.literal('result_present') }),
  /** Приложены файлы итога (#380): у текущей ревизии итога не меньше `min`
   *  живых вложений (kind image|file; стикеры не считаются). */
  z.object({ kind: z.literal('result_files'), min: z.number().int().min(1).max(5) }),
]);
export type WorkflowValidator = z.infer<typeof workflowValidatorSchema>;
export type WorkflowValidatorKind = WorkflowValidator['kind'];

/** Пост-действия — что сделать после перехода (в той же транзакции).
 *  Встроенное (не правило): completedAt ставится входом в «Итог» (closed)
 *  и снимается выходом из него — «Утверждение» (done) не завершение;
 *  личные доски участников переезжают по состоянию. */
export const workflowPostFunctionSchema = z.discriminatedUnion('kind', [
  /** УСТАРЕВШИЙ (#378): ветвление по флагу задачи «принять после завершения»
   *  (accept_required уходит, ADR-0020 дополнение); остаётся только в
   *  архивных переходах истории — новые маршруты его не несут. */
  z.object({ kind: z.literal('route_if_accept_required'), stageCode: z.string().min(1) }),
  /** Если условие выполнено, цель подменяется стадией `toStageId` —
   *  утверждение пропускается. `creator_is_assignee` — старое правило по
   *  полям (совместимость каталога); `approver_is_actor` — по актору (#430,
   *  ADR-0025 п.2): пропуск, только если нажавший сам является утверждающим
   *  целевого статуса. docId: в черновике цель может быть новой стадией
   *  `new:*` (разрешается в uuid при публикации); uuid-only рвал rehydrate
   *  черновика. */
  z.object({
    kind: z.literal('route_if'),
    when: z.enum(['creator_is_assignee', 'approver_is_actor']),
    toStageId: docIdSchema,
  }),
  /** Присвоить номер (#55 Р1/O8 → #630 Р4): письмо (без `fieldId`) берёт
   *  серию из `config.numbering` типа и пишет рег-поля; задача (task)
   *  указывает counter-поле-цель `fieldId` — серия тянется из атрибута,
   *  номер пишется в поле той же транзакцией. Выдача без пропусков; нет
   *  серии/поля — 409 WORKFLOW_NUMBERING_NOT_CONFIGURED (письмо) или
   *  ошибка публикации `number_field_*` (задача, Р5). */
  z.object({ kind: z.literal('assign_number'), fieldId: z.uuid().optional() }),
]);
export type WorkflowPostFunction = z.infer<typeof workflowPostFunctionSchema>;

/** Пост-действия, допустимые в маршруте категории (Р6): `assign_number`
 *  у задач — номер в поле-атрибут (#630, Р4), у писем — рег-номер (#55). */
export const WORKFLOW_POST_FUNCTIONS_BY_CATEGORY = {
  task: ['route_if_accept_required', 'route_if', 'assign_number'],
  letter: ['assign_number'],
} as const satisfies Record<ProcessCategory, readonly WorkflowPostFunction['kind'][]>;

/** Гейты, допустимые в маршруте категории: у писем в #55 гейтов нет —
 *  задачные факты (подзадачи, чек-лист, время, итог) у письма не считаются. */
export const WORKFLOW_VALIDATORS_BY_CATEGORY = {
  task: [
    'no_open_subtasks',
    'checklist_complete',
    'fields_required',
    'time_logged',
    'result_present',
    'result_files',
  ],
  letter: [],
} as const satisfies Record<ProcessCategory, readonly WorkflowValidator['kind'][]>;

export const workflowTransitionRulesSchema = z.object({
  conditions: z.array(workflowConditionSchema).default([]),
  validators: z.array(workflowValidatorSchema).default([]),
  postFunctions: z.array(workflowPostFunctionSchema).default([]),
});
export type WorkflowTransitionRules = z.infer<typeof workflowTransitionRulesSchema>;

/** Причина, по которой переход недоступен/заблокирован (UI — подпись
 *  кнопки и диалог перехода; коды — i18n ui.tasks.gate.*). */
export const transitionBlockReasonSchema = z.object({
  kind: z.enum([
    'no_open_subtasks',
    'checklist_complete',
    'fields_required',
    'time_logged',
    'result_present',
    'result_files',
    /** Ни один источник решающих не резолвится в живого человека (#433):
     *  переход виден только обладателю права обхода и требует причину. */
    'decider_vacant',
  ]),
  /** Для fields_required — какие поля не заполнены (системные и `cf.<id>`). */
  fields: z.array(workflowFieldKeySchema).optional(),
  /** Для no_open_subtasks — сколько подзадач мешают (в строгом режиме
   *  вместе с подзадачами на утверждении). */
  count: z.number().int().min(0).optional(),
  /** Для result_files — сколько файлов итога есть (нужно `min`). */
  min: z.number().int().min(1).max(5).optional(),
});
export type TransitionBlockReason = z.infer<typeof transitionBlockReasonSchema>;

/** Доступный текущему пользователю переход сущности (кнопка маршрута).
 *  Переходы, чьи условия «кто» не пройдены, в выдачу не попадают; гейты —
 *  попадают с `blockedBy` (кнопка видна, объясняет причину). Порядок задаёт
 *  сервер: кнопки статуса по `sortOrder`, затем «из любого» (#378). */
export const workflowTransitionSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  toStageId: z.uuid(),
  toStageName: z.string().min(1),
  /** Системное состояние цели (иконка кнопки: закрыть / вернуть / вперёд). */
  toStageState: taskSystemStateSchema,
  /** Итог целевой стадии (null — не «Итог»): «✓ Завершена» / «✕ Отменена». */
  toStageOutcome: stageOutcomeSchema.nullable(),
  /** Цвет и порядок цели — клиент строит оптимистичную стадию без каталога. */
  toStageColor: stageColorSchema,
  toStageOrder: z.number().int().min(0),
  /** Показ в панели процесса: главная / видна / в меню «Ещё» (#378). */
  display: transitionDisplaySchema,
  /** Смысл кнопки (#430): ждёт действия человека или служебная; служебные
   *  не попадают в «Мои действия» (ADR-0026). */
  intent: workflowTransitionIntentSchema,
  blockedBy: z.array(transitionBlockReasonSchema),
  /** Можно ли пройти гейт с причиной (право task.override_gate). */
  canOverride: z.boolean(),
  /** Окно при нажатии (#380): null — окно выключено. Эффективные разделы
   *  (настройка ∪ гейты) собирает `effectiveWindowSections`. */
  form: transitionFormSchema.nullable(),
  /** Префилл формульных слотов окна (#632, Р12): сервер посчитал значения
   *  при открытии; человек может поправить, в тело уходит значением. */
  formPrefill: z.record(z.string(), customFieldValueSchema).optional(),
  /** Гейты кнопки — для живого списка условий в окне. */
  validators: z.array(workflowValidatorSchema),
});
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;

/** Выполнение перехода. reason — обязательна при обходе гейта (аудит).
 *  form — введённое в окне; сервер сверяет состав с эффективным окном
 *  (лишнее/пропущенное обязательное → 422 WORKFLOW_TRANSITION_FORM_INVALID). */
export const executeTransitionBodySchema = z
  .object({
    override: z.boolean().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    form: transitionFormInputSchema.optional(),
    /** Человек подтвердил выдачу номера с пустым полем в виде номера
     *  (#630, окно «выдать так / вернуться» после 409 NUMBER_SEGMENT_EMPTY). */
    confirmEmptyNumberParts: z.literal(true).optional(),
  })
  .strict();
export type ExecuteTransitionBody = z.infer<typeof executeTransitionBodySchema>;
