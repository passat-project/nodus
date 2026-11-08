import { z } from 'zod';

import { numberContainerSchema } from './number-container.js';

/**
 * Серии номеров (#630, ADR-0037 §8, концепция 08.11): один механизм для всех
 * нумераций — правило «внутри чего свой счёт × когда заново × вид номера ×
 * с чего начинается новый счёт» на сущности `number_series`. Серия 1:1 с
 * определением атрибута типа `counter`: правило ОДНО на атрибут, все его
 * привязки получают номера из одного счётчика (свой счёт — у каждого
 * контейнера: реальной папки/проекта/портфеля, в которой лежит запись).
 * Письмо-серии живут там же без атрибута (серия из `config.numbering` типа).
 */

/** Когда счёт начинается заново: `none` — никогда, `year` — каждый год,
 *  `month` — каждый месяц. Границы — по поясу компании. Допустимость
 *  зависит от вида номера (`numberPeriodsAllowed`): заново «каждый год»
 *  только если в номере есть год — иначе номера разных лет совпадут. */
export const numberPeriodSchema = z.enum(['none', 'year', 'month']);
export type NumberPeriod = z.infer<typeof numberPeriodSchema>;

/** Сегменты вида номера. Ровно один `counter`. Письмо-формат «Вх-2026/118»
 *  — это `[literal 'Вх', literal '-', year 4, literal '/', counter]`. */
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
   *  пустая вставка, выдача не падает. */
  z
    .object({
      kind: z.literal('field'),
      fieldNumber: z.number().int().min(1),
      source: z.enum(['self', 'project']),
    })
    .strict(),
]);
export type NumberTemplateSegment = z.infer<typeof numberTemplateSegmentSchema>;

export const NUMBER_TEMPLATE_LIMITS = { segments: 12, value: 999_999_999 } as const;

/** Какие «начинать заново» допускает вид номера: «никогда» — всегда; «каждый
 *  год» — только с годом в номере; «каждый месяц» — только с месяцем. Одна
 *  функция для диалога (что показать), zod-правила и сервера. */
export function numberPeriodsAllowed(
  template: readonly NumberTemplateSegment[],
): readonly NumberPeriod[] {
  const out: NumberPeriod[] = ['none'];
  if (template.some((segment) => segment.kind === 'year')) out.push('year');
  if (template.some((segment) => segment.kind === 'month')) out.push('month');
  return out;
}

/** Правило серии. `startValue` — с какого номера начинается КАЖДЫЙ новый
 *  счёт (новая папка, новый год); продолжение нумерации конкретного счёта
 *  из Excel/бумаги — «следующий номер» этого счёта (только вперёд), а не
 *  старт правила: иначе «книга со старта 15» начинала бы с 15 каждый год. */
export const numberSeriesRuleSchema = z
  .object({
    container: numberContainerSchema,
    period: numberPeriodSchema,
    template: z.array(numberTemplateSegmentSchema).min(1).max(NUMBER_TEMPLATE_LIMITS.segments),
    startValue: z.number().int().min(1).max(NUMBER_TEMPLATE_LIMITS.value),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.template.filter((s) => s.kind === 'counter').length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: 'exactly one counter segment required',
      });
    }
    if (!numberPeriodsAllowed(rule.template).includes(rule.period)) {
      ctx.addIssue({
        code: 'custom',
        path: ['period'],
        message: 'period requires the matching date segment in the template',
      });
    }
  });
export type NumberSeriesRule = z.infer<typeof numberSeriesRuleSchema>;

/** Части момента выдачи (по поясу компании — у каждого контекста свой). */
export interface NumberMoment {
  year: number;
  month: number;
}

/** Период-часть ключа счёта: '' (никогда), '2026' (год), '2026-11' (месяц). */
export function numberPeriodKey(period: NumberPeriod, at: NumberMoment): string {
  switch (period) {
    case 'year':
      return String(at.year);
    case 'month':
      return `${at.year}-${String(at.month).padStart(2, '0')}`;
    case 'none':
      return '';
  }
}

/** Ключ счёта (PRIMARY KEY строки `number_counters` вместе с series_id):
 *  «id контейнера|период», пустые части не пишутся, без частей — 'common'.
 *  Письмо-серии (вся компания × год) дают '2026' — формат живых строк прода
 *  #55, менять нельзя. Стабилен при переименовании контейнера (uuid). */
export function numberCountKey(containerId: string | null, periodKey: string): string {
  const parts = [containerId ?? '', periodKey].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('|') : 'common';
}

/** Читатель поля-сегмента шаблона: значение атрибута записи (`self`) или её
 *  проекта (`project`). Нет читателя или атрибут удалён/пуст — пустая
 *  вставка. Одна грамматика для сервера, веба и моков. */
export type NumberTemplateFieldReader = (
  segment: Extract<NumberTemplateSegment, { kind: 'field' }>,
) => string;

/** Ввод рендера: момент передан ГОТОВЫМИ частями (год/месяц), а не Date —
 *  пояс компании у каждого контекста свой, рендер остаётся чистым. */
export interface NumberTemplateRenderInput extends NumberMoment {
  seq: number;
  field?: NumberTemplateFieldReader;
}

/** Рендер номера: «Вх-2026/118», «15-26», «Изм. 3», «ОВ1-И-0007». */
export function renderNumberTemplate(
  segments: readonly NumberTemplateSegment[],
  input: NumberTemplateRenderInput,
): string {
  let out = '';
  for (const segment of segments) {
    switch (segment.kind) {
      case 'counter': {
        const digits = String(input.seq);
        out += segment.minLength ? digits.padStart(segment.minLength, '0') : digits;
        break;
      }
      case 'literal':
        out += segment.text;
        break;
      case 'year': {
        const year = String(input.year);
        out += segment.digits === 2 ? year.slice(-2) : year;
        break;
      }
      case 'month':
        out += String(input.month).padStart(2, '0');
        break;
      case 'field':
        out += input.field?.(segment) ?? '';
        break;
    }
  }
  return out;
}
