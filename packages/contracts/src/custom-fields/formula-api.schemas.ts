import { z } from 'zod';

import { customFieldTypeSchema } from './custom-field.schemas.js';
import { customFieldValueSchema } from './custom-field-values.js';
import { formulaHostKindSchema, formulaNodeSchema, formulaValueTypeSchema } from './formula.js';

/**
 * Границы API формул ячейки (#632, Р10/Р13): тело/ответ сохранения и чтения
 * формулы, каталог ошибок ячейки, DTO `customFieldFormulas` и тела
 * validate/evaluate. Движок и AST — `formula.ts`, структурная проверка —
 * `formula-validation.ts`.
 */

/** Тело сохранения формулы ячейки (PUT у владельца хоста). */
export const formulaBodySchema = z.object({ ast: formulaNodeSchema }).strict();
export type FormulaBody = z.infer<typeof formulaBodySchema>;

/** Ответ чтения формулы ячейки (GET у владельца хоста): null — формулы нет.
 *  `origin` — откуда эффективная формула: своя ячейка или формула типа/вида
 *  (редактор показывает её как основу для своей правки, не меняя тип). */
export const formulaResponseSchema = z
  .object({
    ast: formulaNodeSchema.nullable(),
    origin: z.enum(['own', 'type', 'value']).nullable().optional(),
  })
  .strict();
export type FormulaResponse = z.infer<typeof formulaResponseSchema>;

/** Ошибка ячейки-формулы (runtime, не блокирует работу): каталог закрыт,
 *  тексты — i18n `ui.formulas.errors`. */
export const formulaErrorCodeSchema = z.enum([
  /** Атрибут-цель удалён (или удалён атрибут-источник). */
  'attribute_deleted',
  /** Атрибут отвязан от типа/вида либо не входит в тип источника. */
  'attribute_unavailable',
  /** Родитель/ссылка вне правил видимости (Р7). */
  'source_unavailable',
  /** Динамическое несовпадение типа (в т.ч. разные валюты/словари). */
  'type_mismatch',
  /** Живой цикл пересчёта (глубина волны, Р8). */
  'cycle',
  /** Превышена глубина AST/вычисления. */
  'depth_limit',
  'division_by_zero',
  /** Выборка агрегата больше лимита записей. */
  'selection_limit',
  /** Неожиданное исключение вычисления («ядовитая ячейка»). */
  'eval_failed',
]);
export type FormulaErrorCode = z.infer<typeof formulaErrorCodeSchema>;

export const formulaCellErrorSchema = z
  .object({
    code: formulaErrorCodeSchema,
    /** Человеческое пояснение (сервер — русское, i18n-строка по коду). */
    message: z.string().max(300),
    /** Номер атрибута-виновника, если известен (подсветка плашки). */
    number: z.number().int().min(1).optional(),
  })
  .strict();
export type FormulaCellError = z.infer<typeof formulaCellErrorSchema>;

/** Формульное состояние ячеек в DTO сущности. `origin`:
 *  - `own` — своя формула ячейки;
 *  - `type` — действует формула типа/вида (своей формулы и значения нет);
 *  - `value` — вписано значение руками, а у типа/вида ЕСТЬ формула
 *    (кнопка «как у типа» вернёт формулу, Р5).
 *  Запись присутствует в DTO, если есть формула или значение подавляет
 *  формулу типа; ячейки без формул в объект не попадают. `error` — только
 *  у ячейки с ошибкой; значение при ошибке пустое (не показываем протухшее). */
export const customFieldFormulaInfoSchema = z
  .object({
    origin: z.enum(['own', 'type', 'value']),
    error: formulaCellErrorSchema.nullable().optional(),
  })
  .strict();
export type CustomFieldFormulaInfo = z.infer<typeof customFieldFormulaInfoSchema>;

export const customFieldFormulasSchema = z.record(z.uuid(), customFieldFormulaInfoSchema);
export type CustomFieldFormulas = z.infer<typeof customFieldFormulasSchema>;

/** Проблема проверки формулы на границе API (совпадает с движком). */
export const formulaValidationIssueSchema = z
  .object({
    code: z.string().min(1),
    path: z.string(),
    message: z.string().min(1),
    number: z.number().int().min(1).optional(),
    /** true — сохранение отклоняется 422; false — ячейка покажет ошибку. */
    blocking: z.boolean(),
  })
  .strict();
export type FormulaValidationIssue = z.infer<typeof formulaValidationIssueSchema>;

/** `POST /custom-fields/formulas/validate` (#632, Р10): проверка без записи.
 *  `targetFieldId` — тип берётся из реестра; `targetType` — тип без id
 *  (формула слота окна). */
export const formulaValidateBodySchema = z
  .object({
    ast: formulaNodeSchema,
    hostKind: formulaHostKindSchema,
    targetFieldId: z.uuid().optional(),
    targetType: customFieldTypeSchema.optional(),
    /** Формула типа/вида: запрещены related и цепочка папок (Р6). */
    typeDefault: z.boolean().optional(),
  })
  .strict();
export type FormulaValidateBody = z.infer<typeof formulaValidateBodySchema>;

export const formulaValidateResponseSchema = z
  .object({
    ok: z.boolean(),
    type: formulaValueTypeSchema.nullable(),
    issues: z.array(formulaValidationIssueSchema),
  })
  .strict();
export type FormulaValidateResponse = z.infer<typeof formulaValidateResponseSchema>;

/** `POST /custom-fields/formulas/evaluate` (#632, Р10): превью/префилл без
 *  записи. Контекст — существующая запись; создание окна — `creation`. */
export const formulaEvaluateBodySchema = z
  .object({
    ast: formulaNodeSchema,
    context: z
      .object({
        hostKind: formulaHostKindSchema,
        hostId: z.uuid(),
      })
      .strict(),
  })
  .strict();
export type FormulaEvaluateBody = z.infer<typeof formulaEvaluateBodySchema>;

export const formulaEvaluateResponseSchema = z
  .object({
    value: customFieldValueSchema.nullable(),
    error: formulaCellErrorSchema.nullable(),
  })
  .strict();
export type FormulaEvaluateResponse = z.infer<typeof formulaEvaluateResponseSchema>;

/** `POST /projects/:id/nodes/:nodeId/move-preview` и
 *  `POST /tasks/:id/move-preview` (#632, Р10): какие формульные значения
 *  изменятся при переносе — диалог подтверждения (критерий 1). Только
 *  видимые актору записи; пустой список — «ничего не изменится». */
export const formulaMovePreviewEntrySchema = z
  .object({
    hostKind: formulaHostKindSchema,
    hostId: z.uuid(),
    fieldId: z.uuid(),
    /** Человекочитаемая подпись записи (номер/название) — для диалога. */
    hostLabel: z.string().min(1),
    fieldName: z.string().min(1),
    from: customFieldValueSchema.nullable(),
    to: customFieldValueSchema.nullable(),
  })
  .strict();
export type FormulaMovePreviewEntry = z.infer<typeof formulaMovePreviewEntrySchema>;

export const formulaMovePreviewResponseSchema = z
  .object({ changes: z.array(formulaMovePreviewEntrySchema) })
  .strict();
export type FormulaMovePreviewResponse = z.infer<typeof formulaMovePreviewResponseSchema>;
