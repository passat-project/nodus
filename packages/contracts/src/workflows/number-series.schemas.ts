import { z } from 'zod';

import { formulaNodeSchema } from '../custom-fields/formula.js';

/**
 * Серии номеров (#630, ADR-0037 §8): один механизм для всех нумераций —
 * правило «разрез × период × шаблон × старт» на сущности `number_series`.
 * Серия связывается 1:1 с определением атрибута типа `counter` (правило
 * одно на портал, привязки атрибута = сумма областей — один счёт); письмо-
 * серии живут там же без атрибута (серия из `config.numbering` типа).
 */

/** Разрез счёта — где у серии отдельный счётчик. `none` — общий счёт на
 *  портал; `self`/`project`/`portfolio`/`folder` — заготовки по записи
 *  (отдельный счёт у каждой записи/проекта/портфеля/папки); `formula` —
 *  произвольный ключ формулой от записи (В2: абстрактная автоматизация,
 *  заготовки — лишь пресеты). Комбинируются формулой. */
export const numberScopeKindSchema = z.enum([
  'none',
  'self',
  'project',
  'portfolio',
  'folder',
  'formula',
]);
export type NumberScopeKind = z.infer<typeof numberScopeKindSchema>;

/** Период сброса счёта: `none` — сквозной, `year` — «в каждом году»,
 *  `month` — «в каждом месяце». Границы — по поясу компании. */
export const numberPeriodSchema = z.enum(['none', 'year', 'month']);
export type NumberPeriod = z.infer<typeof numberPeriodSchema>;

/** Сегменты шаблона номера. Ровно один `counter` — шаблон без номера не
 *  имеет смысла (refine правила). Письмо-формат «Вх-2026/118» — это
 *  `[literal 'Вх', literal '-', year 4, literal '/', counter]`. */
export const numberTemplateSegmentSchema = z.discriminatedUnion('kind', [
  /** Порядковый номер; `minLength` — добивка нулями слева (3 → «007»). */
  z
    .object({ kind: z.literal('counter'), minLength: z.number().int().min(0).max(10).optional() })
    .strict(),
  /** Буквенный текст: префикс, дефис, разделитель. */
  z.object({ kind: z.literal('literal'), text: z.string().min(1).max(50) }).strict(),
  /** Год момента выдачи: 2 цифры («26») или 4 («2026»). */
  z.object({ kind: z.literal('year'), digits: z.union([z.literal(2), z.literal(4)]) }).strict(),
  /** Месяц момента выдачи, две цифры («01»…«12»). */
  z.object({ kind: z.literal('month') }).strict(),
  /** Значение атрибута записи (`self`) или её проекта (`project`) — «код по
   *  реквизиту» в номере (инв. № в накладной). Атрибут удалён или пуст —
   *  пустая вставка, выдача не падает (Р2). */
  z
    .object({
      kind: z.literal('field'),
      fieldNumber: z.number().int().min(1),
      source: z.enum(['self', 'project']),
    })
    .strict(),
]);
export type NumberTemplateSegment = z.infer<typeof numberTemplateSegmentSchema>;

export const NUMBER_TEMPLATE_LIMITS = { segments: 12 } as const;

/** Правило серии: разрез × период × шаблон × старт. Хранится колонками
 *  `number_series`; стартовое значение — продолжение нумерации из Excel
 *  (первый номер группы = startValue). */
export const numberSeriesRuleSchema = z
  .object({
    scopeKind: numberScopeKindSchema,
    /** Формула разреза (AST формул #632) — только при `scopeKind='formula'`. */
    scopeFormula: formulaNodeSchema.nullable().optional(),
    period: numberPeriodSchema,
    template: z.array(numberTemplateSegmentSchema).min(1).max(NUMBER_TEMPLATE_LIMITS.segments),
    startValue: z.number().int().min(1).max(999_999_999),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.scopeKind === 'formula' && rule.scopeFormula == null) {
      ctx.addIssue({ code: 'custom', path: ['scopeFormula'], message: 'scope formula required' });
    }
    if (rule.scopeKind !== 'formula' && rule.scopeFormula != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeFormula'],
        message: 'scope formula allowed only for scopeKind=formula',
      });
    }
    if (rule.template.filter((s) => s.kind === 'counter').length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: 'exactly one counter segment required',
      });
    }
  });
export type NumberSeriesRule = z.infer<typeof numberSeriesRuleSchema>;
