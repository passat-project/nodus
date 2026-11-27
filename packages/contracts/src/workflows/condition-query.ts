import { z } from 'zod';

import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { customFieldValueSchema } from '../custom-fields/custom-field-values.js';
import {
  formulaRelationDirectionSchema,
  formulaRelationKindSchema,
} from '../custom-fields/formula.js';
import { projectRoleSchema } from '../projects/project.schemas.js';
import type { ProcessCategory } from './process-type.schemas.js';
import { stageOutcomeSchema, taskSystemStateSchema } from './workflow-primitives.schemas.js';

/**
 * Общая выборка (#635, unified-model §7 «Одна выборка на всё»): один способ
 * описать «какие записи → условие → сколько». Вводится здесь для проверок и
 * условий кнопок; условия шагов/правил (#634/#448), показатели папки (#865)
 * и расширенный фильтр списков (#435) используют ЭТУ схему и своего языка
 * условий не заводят. Вычисление — один вход на сервере (README модуля
 * workflows), по живым данным, с фильтром видимости актора («видимость одна»).
 */

export const CONDITION_LIMITS = {
  /** Предикатов в одной выборке (И). */
  predicates: 10,
  /** Записей в причине отказа, показываемых человеку; дальше — «и ещё N». */
  reasonRecords: 5,
  /** Дополнительных сотрудников в настройке обхода. */
  overrideUsers: 50,
  /** Подпись причины/условия, которую пишет настройщик. */
  titleLength: 200,
} as const;

/**
 * «Какие записи» — субъект выборки. Имена источников сознательно совпадают с
 * селекторами формул (formula.ts): вычисление читает те же множества через
 * порт RecordValuesReader. `registry_rows` добавит #636.
 */
export const conditionSubjectSchema = z.discriminatedUnion('kind', [
  /** Эта запись (задача/письмо). */
  z.object({ kind: z.literal('self') }),
  /** Родительская задача. */
  z.object({ kind: z.literal('parent_task') }),
  /** Подзадачи этой задачи. */
  z.object({ kind: z.literal('subtasks') }),
  /** Связанные задачи: вид связи и направление. */
  z.object({
    kind: z.literal('relations'),
    relation: formulaRelationKindSchema,
    direction: formulaRelationDirectionSchema,
  }),
  /** Задачи папки этой записи. */
  z.object({ kind: z.literal('folder_tasks') }),
  /** Задачи проекта этой записи (у письма — проект письма, если назначен). */
  z.object({ kind: z.literal('project_tasks') }),
  /** Папки проекта; `folderTypeId` сужает по типу папки. */
  z.object({ kind: z.literal('project_folders'), folderTypeId: z.uuid().optional() }),
  /** Работы в папках указанного типа (во всём проекте записи). */
  z.object({ kind: z.literal('folder_type_tasks'), folderTypeId: z.uuid() }),
  /** Сам проект: поля и статус. */
  z.object({ kind: z.literal('project') }),
  /** Записи по ссылке из поля-ссылки этой записи. */
  z.object({ kind: z.literal('ref_field'), field: customFieldKeySchema }),
]);
export type ConditionSubject = z.infer<typeof conditionSubjectSchema>;
export type ConditionSubjectKind = ConditionSubject['kind'];

/** Субъекты, имеющие смысл у категории: чего нет — редактор не предлагает
 *  (чек-лист у письма), публикация чужого — ошибка документа. */
export const CONDITION_SUBJECTS_BY_CATEGORY = {
  task: [
    'self',
    'parent_task',
    'subtasks',
    'relations',
    'folder_tasks',
    'project_tasks',
    'project_folders',
    'folder_type_tasks',
    'project',
    'ref_field',
  ],
  letter: ['self', 'relations', 'project_tasks', 'project_folders', 'project', 'ref_field'],
} as const satisfies Record<ProcessCategory, readonly ConditionSubjectKind[]>;

/** Операторы сравнения значения поля. Совместимость оператора с типом
 *  атрибута проверяет публикация (тип известен из определения атрибута). */
export const conditionFieldOpSchema = z.enum([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  /** Пересечение (multienum, «Сотрудник(и)»). */
  'in_any',
  /** Поле заполнено / не заполнено (без значения). */
  'filled',
  'not_filled',
]);
export type ConditionFieldOp = z.infer<typeof conditionFieldOpSchema>;

/** Условие по одной записи выборки. */
export const conditionPredicateSchema = z.discriminatedUnion('kind', [
  /** Запись этого типа. */
  z.object({ kind: z.literal('type_is'), typeId: z.uuid() }),
  /** Значение поля записи (атрибут `cf.<uuid>`). `value: null` — «пусто». */
  z.object({
    kind: z.literal('field'),
    field: customFieldKeySchema,
    op: conditionFieldOpSchema,
    value: customFieldValueSchema.nullable().optional(),
  }),
  /** Конкретный статус типа записи: стадия опубликованного маршрута этого
   *  типа. Ссылку проверяет публикация (стадия удалена — ошибка). */
  z.object({ kind: z.literal('stage_is'), stageId: z.uuid() }),
  /** Системное состояние записи (в работе / закрыта / …). */
  z.object({ kind: z.literal('system_state'), state: taskSystemStateSchema }),
  /** Итог закрытой записи. */
  z.object({ kind: z.literal('outcome'), outcome: stageOutcomeSchema }),
  /** «Результат выдан»: отметка статуса маршрута (§11); без отметок в
   *  маршруте «выдана» = закрыта успешно. */
  z.object({ kind: z.literal('result_issued') }),
]);
export type ConditionPredicate = z.infer<typeof conditionPredicateSchema>;

/** «Сколько»: все / хотя бы одна / ни одной. */
export const conditionQuantifierSchema = z.enum(['all', 'any', 'none']);
export type ConditionQuantifier = z.infer<typeof conditionQuantifierSchema>;

/** Общая выборка: субъект → условия по записям (И) → квантор. */
export const conditionQuerySchema = z.object({
  subject: conditionSubjectSchema,
  where: z.array(conditionPredicateSchema).max(CONDITION_LIMITS.predicates).default([]),
  quantifier: conditionQuantifierSchema,
});
export type ConditionQuery = z.infer<typeof conditionQuerySchema>;

/** Настройка обхода проверки: по умолчанию — руководство проекта в своём
 *  проекте (руководитель и помощники) и обладатели `task.override_gate`;
 *  можно добавить сотрудников или роль в проекте; `forbidden` — не обходит
 *  никто. Причина обязательна всегда (история записи и проекта). */
export const gateOverridePolicySchema = z.object({
  mode: z.enum(['default', 'forbidden']).default('default'),
  extraUserIds: z.array(z.uuid()).max(CONDITION_LIMITS.overrideUsers).default([]),
  projectRole: projectRoleSchema.optional(),
});
export type GateOverridePolicy = z.infer<typeof gateOverridePolicySchema>;

export const DEFAULT_GATE_OVERRIDE: GateOverridePolicy = { mode: 'default', extraUserIds: [] };

/** Запись, на которую ссылается причина («Не принято: Задание → КЖ1.1»). */
export const conditionRecordRefSchema = z.object({
  id: z.uuid(),
  entityKind: z.enum(['task', 'letter', 'project', 'node']),
  /** Человекочитаемое имя на момент проверки. */
  name: z.string().min(1).max(300),
});
export type ConditionRecordRef = z.infer<typeof conditionRecordRefSchema>;
