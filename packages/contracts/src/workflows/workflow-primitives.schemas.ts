import { z } from 'zod';

/**
 * Примитивы схем маршрутов (ADR-0020/0021): системное состояние, палитра
 * тонов, итог статуса, показ кнопки перехода. Живут отдельным файлом без
 * зависимостей — на них опираются task.schemas, task-type.schemas,
 * workflow.schemas и workflow-document.schemas, а циклы импортов в
 * contracts запрещены (инициализация zod-схем на границе модуля).
 */

/** Скрытая ось аналитики (status category, ADR-0008); в маршруте задач
 *  этапы: Ожидание / В работе / Пауза / Утверждение / Итог (#378).
 *  `done` = «Утверждение» — работа сдана и ждёт приёмки, НЕ завершение
 *  (фаза review; завершение — только `closed`). Классификация — только
 *  хелперами фаз `task-state-phase.ts` (ADR-0020, дополнение 2). */
export const taskSystemStateSchema = z.enum(['backlog', 'active', 'paused', 'done', 'closed']);
export type TaskSystemState = z.infer<typeof taskSystemStateSchema>;

/** Цвет стадии/типа — ключ палитры тонов темы (не hex: тема подменяет значения). */
export const stageColorSchema = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
export type StageColor = z.infer<typeof stageColorSchema>;

/** Итог статуса — только у этапа «Итог» (closed): выполнена / отменена /
 *  отклонена; от него зависят уведомления и аналитика (ADR-0020 дополнение,
 *  ADR-0025 п.1, #430). Отклонена — отказ утверждающего, отличимый от
 *  отзыва инициатором. */
export const stageOutcomeSchema = z.enum(['success', 'cancelled', 'rejected']);
export type StageOutcome = z.infer<typeof stageOutcomeSchema>;

/** Смысл кнопки перехода (#430, ADR-0024 п.6): «ждёт действия человека»
 *  (action) или служебная (service) — служебные не попадают в «Мои
 *  действия» (ADR-0026). Умный дефолт — `smartIntent` в workflow-intent.ts. */
export const workflowTransitionIntentSchema = z.enum(['action', 'service']);
export type WorkflowTransitionIntent = z.infer<typeof workflowTransitionIntentSchema>;

/** Показ кнопки перехода в панели процесса карточки: главная (залитая,
 *  одна на статус) / видна / в меню «Ещё» (#378). */
export const transitionDisplaySchema = z.enum(['primary', 'button', 'menu']);
export type TransitionDisplay = z.infer<typeof transitionDisplaySchema>;

/** Ид элемента документа маршрута: uuid существующей записи или временный
 *  `new:*` нового (разрешается в uuid при публикации, #378). */
export const docIdSchema = z.union([z.uuid(), z.string().regex(/^new:[a-z0-9-]{1,36}$/)]);
export type DocId = z.infer<typeof docIdSchema>;
