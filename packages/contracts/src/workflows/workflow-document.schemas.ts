import { z } from 'zod';

import { userRefSchema } from '../directory/user-ref.schema.js';
import { creationFormSchema } from './creation-form.js';
import { pressConfigDraftSchema, pressConfigSchema } from './press.js';
import { transitionFormDraftSchema, transitionFormSchema } from './transition-form.schemas.js';
import {
  stageColorSchema,
  stageOutcomeSchema,
  taskSystemStateSchema,
  transitionDisplaySchema,
  workflowTransitionIntentSchema,
} from './workflow-primitives.schemas.js';
import { workflowTransitionRulesSchema } from './workflow.schemas.js';

/**
 * Документ маршрута — рабочая копия редактора (#378, ADR-0021): стадии и
 * переходы целиком, живёт на клиенте до публикации. Две формы: СТРОГАЯ
 * (граница публикации: имена обязательны, лимиты) и ЧЕРНОВИК (внутри
 * редактора: имена могут быть пустыми, лимиты не режутся — их нарушения
 * показывает живая проверка `checkWorkflowDocument`, а не zod).
 */

// docIdSchema (uuid | new:*) — примитив workflow-primitives: им пользуются
// и документ, и правила route_if (цель может быть новой стадией черновика).
export { docIdSchema } from './workflow-primitives.schemas.js';
export type { DocId } from './workflow-primitives.schemas.js';
import { docIdSchema } from './workflow-primitives.schemas.js';

/** Стадия черновика (пустое имя допустимо — проверка покажет empty_name). */
export const workflowDraftStageSchema = z.object({
  id: docIdSchema,
  /** Код системной стадии (только чтение; у новых — null, сервер не верит клиенту). */
  code: z.string().min(1).nullable(),
  name: z.string().max(40),
  color: stageColorSchema,
  systemState: taskSystemStateSchema,
  outcome: stageOutcomeSchema.nullable(),
  isInitial: z.boolean(),
  sortOrder: z.number().int().min(0),
});
export type WorkflowDraftStage = z.infer<typeof workflowDraftStageSchema>;

export const workflowDraftTransitionSchema = z.object({
  id: docIdSchema,
  code: z.string().min(1).nullable(),
  name: z.string().max(32),
  /** null — «из любого статуса». */
  fromStageId: docIdSchema.nullable(),
  toStageId: docIdSchema,
  display: transitionDisplaySchema,
  /** Смысл кнопки (#430): action — ждёт действия человека, service —
   *  служебная. `default('action')` — старые черновики и моки без поля. */
  intent: workflowTransitionIntentSchema.default('action'),
  sortOrder: z.number().int().min(0),
  rules: workflowTransitionRulesSchema,
  /** Окно при нажатии (#380): публикуется вместе с кнопкой (ADR-0021). */
  form: transitionFormDraftSchema.default({ enabled: false, sections: [] }),
  /** «Кнопку жмут несколько» (#434): кнопка обычного маршрута, которую
   *  участники жмут по очереди/одновременно; после кворума переход
   *  выполняется один раз. null — обычная кнопка. */
  press: pressConfigDraftSchema.nullable().optional(),
});
export type WorkflowDraftTransition = z.infer<typeof workflowDraftTransitionSchema>;

/** Точка подключения стрелки на статусе: сторона (t/r/b/l) + слот 1..3 —
 *  12 точек, как в редакторе Яндекс Трекера (#378, ред. 2). */
export const flowHandleIdSchema = z.enum([
  't1',
  't2',
  't3',
  'r1',
  'r2',
  'r3',
  'b1',
  'b2',
  'b3',
  'l1',
  'l2',
  'l3',
]);
export type FlowHandleId = z.infer<typeof flowHandleIdSchema>;

const flowCoordSchema = z.number().finite().min(-100_000).max(100_000);
export const flowPointSchema = z.object({ x: flowCoordSchema, y: flowCoordSchema });
export type FlowPoint = z.infer<typeof flowPointSchema>;

export const workflowLayoutTransitionSchema = z.object({
  sourceHandle: flowHandleIdSchema.optional(),
  targetHandle: flowHandleIdSchema.optional(),
  /** Положение подписи вдоль стрелки: 0 — у источника, 1 — у цели. */
  labelT: z.number().min(0).max(1).optional(),
  /** Метка «Любой статус» кнопки из любого статуса — позиция на холсте. */
  anchor: flowPointSchema.optional(),
  /** Глубина обхода U-стрелки (вход и выход с одной стороны), px холста:
   *  фиксируется, чтобы перестановка соседей не перестраивала стрелку. */
  offset: z.number().int().min(0).max(400).optional(),
  /** Сдвиг свободного участка «ступеньки»/обхода «за спиной» от авто-
   *  положения, px холста: стрелку отодвинули вручную (#395). */
  shift: z.number().int().min(-2000).max(2000).optional(),
});
export type WorkflowLayoutTransition = z.infer<typeof workflowLayoutTransitionSchema>;

/** Раскладка холста — ОБЩАЯ для всех: позиции статусов, точки подключения,
 *  подписи, глубины обходов. Это оформление, не маршрут: сохраняется сразу,
 *  БЕЗ новой версии (`PUT .../layout`), а записи новых элементов (new:*) —
 *  вместе с их публикацией. Нет записи элемента — авторасстановка. */
export const workflowLayoutSchema = z
  .object({
    stages: z.record(docIdSchema, flowPointSchema),
    transitions: z.record(docIdSchema, workflowLayoutTransitionSchema),
  })
  .refine((v) => Object.keys(v.stages).length <= 40 && Object.keys(v.transitions).length <= 160, {
    message: 'layout too large',
  });
export type WorkflowLayout = z.infer<typeof workflowLayoutSchema>;

export const workflowDraftDocumentSchema = z.object({
  stages: z.array(workflowDraftStageSchema),
  transitions: z.array(workflowDraftTransitionSchema),
  layout: workflowLayoutSchema.optional(),
  /** Окно узла «Создание» (#432, В1): форма создания типа — раздел
   *  документа, публикуется версиями вместе с маршрутом; `null` — форма по
   *  умолчанию категории. Старые черновики без раздела валидны. */
  creation: creationFormSchema.nullable().optional(),
});
export type WorkflowDraftDocument = z.infer<typeof workflowDraftDocumentSchema>;

/** Документ на границе публикации: имена обязательны, лимиты схемы
 *  (больше 20 статусов / 80 кнопок сюда не проходит — но проверка
 *  `checkWorkflowDocument` сообщает об этом раньше, живыми подсказками). */
export const workflowDocStageSchema = workflowDraftStageSchema.extend({
  name: z.string().trim().min(1).max(40),
});
export const workflowDocTransitionSchema = workflowDraftTransitionSchema.extend({
  name: z.string().trim().min(1).max(32),
  /** Строгая форма границы публикации: пустые подписи отвергаются. */
  form: transitionFormSchema.default({ enabled: false, sections: [] }),
  /** На границе публикации источник сбора обязателен. */
  press: pressConfigSchema.nullable().optional(),
});

export const workflowDocumentSchema = z.object({
  stages: z.array(workflowDocStageSchema).min(1).max(20),
  transitions: z.array(workflowDocTransitionSchema).max(80),
  layout: workflowLayoutSchema.optional(),
  /** Форма создания типа (#432): публикуется вместе с маршрутом. */
  creation: creationFormSchema.nullable().optional(),
});
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;

/** `GET /workflows/:id` — документ маршрута + версия + счётчики сущностей
 *  по статусам (диалог публикации и сводка изменений). */
export const workflowDetailSchema = z.object({
  id: z.uuid(),
  /** Типы, использующие маршрут (схема «тип → маршрут»). */
  typeIds: z.array(z.uuid()),
  version: z.number().int().min(1),
  publishedAt: z.iso.datetime().nullable(),
  publishedBy: userRefSchema.nullable(),
  document: workflowDocumentSchema,
  /** Сколько сущностей категории в каждой стадии (uuid → count). */
  stageEntityCounts: z.record(z.uuid(), z.number().int().min(0)),
});
export type WorkflowDetail = z.infer<typeof workflowDetailSchema>;

/** Перенос сущностей архивируемой стадии (обязателен, если в стадии есть
 *  сущности; цель может быть новой стадией документа — docId). */
export const workflowMigrationSchema = z.object({
  fromStageId: z.uuid(),
  toStageId: docIdSchema,
});
export type WorkflowMigration = z.infer<typeof workflowMigrationSchema>;

/** `POST /workflows/:id/publish` — публикация с оптимистичной
 *  версией (несовпадение → 409 WORKFLOW_VERSION_CONFLICT). */
export const publishWorkflowBodySchema = z.object({
  baseVersion: z.number().int().min(1),
  document: workflowDocumentSchema,
  migrations: z.array(workflowMigrationSchema).max(20).default([]),
});
export type PublishWorkflowBody = z.infer<typeof publishWorkflowBodySchema>;

export const publishWorkflowResultSchema = z.object({
  version: z.number().int().min(1),
  publishedAt: z.iso.datetime(),
  /** Сколько сущностей поставлено в фоновый перенос (BullMQ). */
  scheduledMoves: z.number().int().min(0),
});
export type PublishWorkflowResult = z.infer<typeof publishWorkflowResultSchema>;

/** `PUT /workflows/:id/layout` — расстановка холста сохраняется сразу,
 *  без новой версии маршрута (#378 ред. 2, вердикт владельца 20.10:
 *  перестановка «для красоты» версию не выпускает). Записи удалённых и
 *  new:* элементов сервер отбрасывает; ответ — сохранённая раскладка. */
export const saveWorkflowLayoutBodySchema = z.object({ layout: workflowLayoutSchema });
export type SaveWorkflowLayoutBody = z.infer<typeof saveWorkflowLayoutBodySchema>;

export const saveWorkflowLayoutResultSchema = z.object({ layout: workflowLayoutSchema });
export type SaveWorkflowLayoutResult = z.infer<typeof saveWorkflowLayoutResultSchema>;

/** Коды проблем схемы маршрута: ошибки запрещают публикацию, предупреждения
 *  — нет. Тексты — i18n `ui.automation.problems.<code>`; список закрыт
 *  (расширение = новое правило проверки там же). */
export const workflowProblemCodeSchema = z.enum([
  'no_initial',
  'multiple_initial',
  'unreachable_stage',
  'dead_end_stage',
  'no_closed_stage',
  'empty_name',
  'duplicate_stage_name',
  'duplicate_button_name',
  'self_loop',
  'no_roles',
  'multiple_primary',
  'route_if_invalid',
  'outcome_mismatch',
  'too_many_stages',
  'too_many_transitions',
  'no_primary',
  'closed_without_exit',
  'duplicate_with_any',
  'form_empty_label',
  'form_useless_section',
  'form_duplicate_section',
  /** Атрибуты в окне и гейтах (#431): неизвестный — ошибка, скрытый в окне — предупреждение. */
  'custom_field_unknown',
  /** Атрибут не привязан к типу процесса (#432, Р8): в его форме, окнах и
   *  условиях такой атрибут не выбирается — ошибка публикации. */
  'custom_field_not_in_type',
  /** Форма создания типа (#432, Р2/Р4): дубль слота, «обязательно» у поля,
   *  которое всегда заполнено, скрытое значение у срока, обязательное и
   *  скрытое одновременно, скрытый атрибут видимым полем, недоступное поле
   *  (проекты выключены) и негодное значение пресета. */
  'creation_duplicate_field',
  'creation_required_not_allowed',
  'creation_preset_not_allowed',
  'creation_preset_invalid',
  'creation_hidden_required',
  'creation_field_unavailable',
  /** Словарь категории (#55, Р6): роль, раздел окна, гейт или пост-действие
   *  чужой категории (роль письма в маршруте задачи, задачный гейт у письма)
   *  — ошибки; присвоение номера без серии у типа — ошибка; регистрация без
   *  присвоения номера — предупреждение. */
  'role_not_in_category',
  'section_not_in_category',
  'gate_not_in_category',
  'post_function_not_in_category',
  'numbering_not_configured',
  'registration_without_number',
  /** «Присвоить номер» задачи (#630, Р5): поле-цель не выбрано или не
   *  привязано к типу / поле не counter-атрибут с правилом серии. */
  'number_field_not_in_type',
  'number_field_not_counter',
  /** Кнопка-действие без условий «кто видит» (#430): в «Мои действия»
   *  держателем станет ответственный — предупреждение, не ошибка. */
  'action_without_visibility',
  /** Имя статуса совпадает с именем того же этапа в другом опубликованном
   *  маршруте (#430): на доске это одна колонка — норма, предупреждение. */
  'stage_name_shared',
  /** Имя статуса похоже на имя из другого маршрута после нормализации
   *  (регистр, ё/е, пробелы) — на доске будет отдельная колонка. */
  'stage_name_similar',
  /** Две кнопки из одного статуса ведут в один статус (#430) — дубль. */
  'duplicate_transition_target',
  /** Правило `approver_is_actor` не сможет определить утверждающего:
   *  у целевого статуса нет единственной основной action-кнопки с условиями. */
  'approver_rule_unresolvable',
  /** Решающие (#433). */
  'decider_not_in_category',
  'decider_field_not_user',
  'decider_position_missing',
  'decider_position_empty',
  'decider_window_needs_rights',
  'decider_source_empty',
  /** Формула-подстановка слота (#632, Р12): AST не проходит грамматику языка
   *  (глубина, арность, матрица источников, запрет related в форме создания)
   *  или результат не подходит к типу поля. Публикация с такой формулой дала
   *  бы пустой слот в окне или 422 на сохранении — отклоняем заранее. */
  'formula_invalid',
  /** Конструктор окон (#496, Р8): пустой заголовок или пояснение в окне;
   *  замок на незакрепляемом ключе (чек-лист, итог, время, неизвестное
   *  системное поле); замок на атрибуте, не привязанном к типу маршрута. */
  'form_decor_empty',
  'form_lock_key_invalid',
  'form_lock_field_not_in_type',
]);
export type WorkflowProblemCode = z.infer<typeof workflowProblemCodeSchema>;

export const workflowProblemSchema = z.object({
  code: workflowProblemCodeSchema,
  severity: z.enum(['error', 'warning']),
  stageId: docIdSchema.optional(),
  transitionId: docIdSchema.optional(),
  /** Ключ слота формы создания (#432); `'*'` — форма целиком. */
  creationField: z.string().min(1).optional(),
  /** Человекочитаемая деталь проблемы (какой именно слот/узел формулы):
   *  код проблемы — короткая формулировка, деталь уточняет её в 422 и логах. */
  detail: z.string().min(1).max(300).optional(),
});
export type WorkflowProblem = z.infer<typeof workflowProblemSchema>;
