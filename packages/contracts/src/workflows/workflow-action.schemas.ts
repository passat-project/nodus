import { z } from 'zod';

import { customFieldValueSchema } from '../custom-fields/custom-field-values.js';
import { transitionFormDraftSchema, transitionFormSchema } from './transition-form.schemas.js';
import { workflowPostFunctionSchema, workflowTransitionRulesSchema } from './workflow.schemas.js';
import { docIdSchema } from './workflow-primitives.schemas.js';
import { transitionDisplaySchema } from './workflow-primitives.schemas.js';

/**
 * Действие — кнопка маршрута БЕЗ смены статуса (#633, ADR-0037 п.5):
 * открывает окно и/или выполняет шаги, пишет запись в журнал, но оставляет
 * статус прежним. Поэтому это не «переход в себя»: self_loop к действию не
 * относится, а «время в статусах» не разрывается.
 *
 * Живёт в документе маршрута рядом со стадиями/переходами и публикуется
 * версией (ADR-0021). Стоит у конкретного статуса или у «любого»
 * (`stageId: null`). Вынесено отдельным файлом: схема документа и так на
 * пределе размера (I5).
 */
export const workflowDraftActionSchema = z.object({
  id: docIdSchema,
  code: z.string().min(1).nullable(),
  name: z.string().max(40),
  /** null — «в любом статусе». */
  stageId: docIdSchema.nullable(),
  display: transitionDisplaySchema,
  sortOrder: z.number().int().min(0),
  /** Кто видит и кто может нажать: те же условия, что у перехода (#430/#433). */
  rules: workflowTransitionRulesSchema,
  /** Окно при нажатии (конструктор форм #496), публикуется вместе с действием. */
  form: transitionFormDraftSchema.default({ enabled: false, sections: [] }),
  /** Шаги действия — пост-функции ядра; каталог шагов — отдельный issue.
   *  Потолок — предохранитель от раздувания документа (действия ≤ 40). */
  steps: z.array(workflowPostFunctionSchema).max(20).default([]),
});
export type WorkflowDraftAction = z.infer<typeof workflowDraftActionSchema>;

/** Граница публикации: имя обязательно, окно — строгая форма. */
export const workflowDocActionSchema = workflowDraftActionSchema.extend({
  name: z.string().trim().min(1).max(40),
  form: transitionFormSchema.default({ enabled: false, sections: [] }),
});
export type WorkflowDocAction = z.infer<typeof workflowDocActionSchema>;

/** Действие в панели процесса карточки (#633): что показать нажавшему.
 *  Условия «кто видит» и шаги на клиент не уходят — сервер уже отфильтровал
 *  по видимости и исполняемости. */
export const workflowActionSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  display: transitionDisplaySchema,
  /** Окно при нажатии: null — окно выключено (действие — просто запись). */
  form: transitionFormSchema.nullable(),
  /** Префилл формульных слотов окна (#632, Р12): сервер посчитал значения
   *  при открытии — тот же контракт, что у кнопки-перехода. */
  formPrefill: z.record(z.string(), customFieldValueSchema).optional(),
});
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
