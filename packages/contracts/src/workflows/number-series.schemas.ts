import { z } from 'zod';

import {
  NUMBER_CONTAINERS_MAX,
  numberContainerKey,
  numberContainerSchema,
  type NumberContainer,
  type NumberHostKind,
} from './number-container.js';

/**
 * Серии номеров (#630, ADR-0037 §8, модель v3 — вердикты владельца 08.11):
 * один механизм для всех нумераций — правило «отдельно для каких условий ×
 * когда заново × вид номера × старт и шаг» на сущности `number_series`.
 * Серия 1:1 с определением атрибута типа `counter`: правило ОДНО на атрибут,
 * все его привязки получают номера из одного счётчика (свой счёт — у каждого
 * набора значений условий). КОГДА выдаётся номер — свойство каждой
 * привязки («Кто получает номер»), а не правила. Письмо-серии живут там же
 * без атрибута (серия из `config.numbering` типа).
 */

/** Когда счёт начинается заново. Границы — по поясу компании. Допустимость
 *  зависит от вида номера (`numberPeriodsAllowed`): иначе номера разных
 *  периодов совпадут. */
export const numberPeriodSchema = z.enum(['none', 'year', 'quarter', 'month', 'day']);
export type NumberPeriod = z.infer<typeof numberPeriodSchema>;

/** Откуда поле-вставка берёт значение: сама запись, её проект, родительская
 *  задача, ближайшая папка вида (`nodeKindId`) или «Компания». Те же
 *  источники, что у формул (ADR-0037 §3). */
export const numberFieldSourceSchema = z.enum([
  'self',
  'project',
  'parent_task',
  'folder',
  'company',
]);
export type NumberFieldSource = z.infer<typeof numberFieldSourceSchema>;

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
  /** Квартал момента выдачи, одна цифра («1»…«4»). */
  z.object({ kind: z.literal('quarter') }).strict(),
  /** Месяц момента выдачи, две цифры («01»…«12»). */
  z.object({ kind: z.literal('month') }).strict(),
  /** День месяца момента выдачи, две цифры («01»…«31»). */
  z.object({ kind: z.literal('day') }).strict(),
  /** Значение атрибута — «код по реквизиту» в номере (Инв. № проекта в
   *  накладной). Пусто — выдача спрашивает подтверждение (409
   *  `NUMBER_SEGMENT_EMPTY`, флаг `confirmEmptyNumberParts`). */
  z
    .object({
      kind: z.literal('field'),
      fieldNumber: z.number().int().min(1),
      source: numberFieldSourceSchema,
      /** Только у `source: 'folder'` — вид ближайшей папки. */
      nodeKindId: z.uuid().optional(),
    })
    .strict(),
]);
export type NumberTemplateSegment = z.infer<typeof numberTemplateSegmentSchema>;
export type NumberFieldSegment = Extract<NumberTemplateSegment, { kind: 'field' }>;

export const NUMBER_TEMPLATE_LIMITS = { segments: 12, value: 999_999_999, step: 1000 } as const;

/** Какие «начинать заново» допускает вид номера: «никогда» — всегда; «каждый
 *  год» — с годом; «каждый квартал» — с годом и кварталом (или месяцем);
 *  «каждый месяц» — с годом и месяцем; «каждый день» — с годом, месяцем и
 *  днём. Без года номера соседних лет совпали бы. Одна функция для окна,
 *  zod-правила и сервера. */
export function numberPeriodsAllowed(
  template: readonly NumberTemplateSegment[],
): readonly NumberPeriod[] {
  const has = (kind: NumberTemplateSegment['kind']) => template.some((s) => s.kind === kind);
  const out: NumberPeriod[] = ['none'];
  if (!has('year')) return out;
  out.push('year');
  if (has('quarter') || has('month')) out.push('quarter');
  if (has('month')) out.push('month');
  if (has('month') && has('day')) out.push('day');
  return out;
}

/** Правило серии. `startValue` — с какого номера начинается КАЖДЫЙ новый
 *  счёт (новая папка, новый год); продолжение нумерации конкретного счёта
 *  из Excel/бумаги — «следующий номер» этого счёта (только вперёд), а не
 *  старт правила: иначе «книга со старта 15» начинала бы с 15 каждый год. */
export const numberSeriesRuleSchema = z
  .object({
    /** «Вести счёт отдельно для»: пусто — сквозная нумерация. */
    containers: z.array(numberContainerSchema).max(NUMBER_CONTAINERS_MAX),
    period: numberPeriodSchema,
    template: z.array(numberTemplateSegmentSchema).min(1).max(NUMBER_TEMPLATE_LIMITS.segments),
    startValue: z.number().int().min(1).max(NUMBER_TEMPLATE_LIMITS.value),
    /** Шаг номера (1 → 1, 2, 3; 10 → 10, 20, 30). */
    step: z.number().int().min(1).max(NUMBER_TEMPLATE_LIMITS.step),
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
        message: 'period requires the matching date segments in the template',
      });
    }
    const keys = rule.containers.map(numberContainerKey);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['containers'], message: 'duplicate condition' });
    }
    rule.template.forEach((segment, index) => {
      if (segment.kind !== 'field') return;
      if ((segment.source === 'folder') !== (segment.nodeKindId !== undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['template', index],
          message: 'nodeKindId is required exactly for source=folder',
        });
      }
    });
  });
export type NumberSeriesRule = z.infer<typeof numberSeriesRuleSchema>;

/** Части момента выдачи (по поясу компании — у каждого контекста свой). */
export interface NumberMoment {
  year: number;
  month: number;
  day: number;
}

const two = (value: number) => String(value).padStart(2, '0');

/** Квартал месяца: 1…4. */
export function numberQuarterOf(month: number): number {
  return Math.ceil(month / 3);
}

/** Период-часть ключа счёта: '' (никогда), '2026', '2026-Q1', '2026-11',
 *  '2026-11-08'. Формат года — ключ живых строк писем прода (#55). */
export function numberPeriodKey(period: NumberPeriod, at: NumberMoment): string {
  switch (period) {
    case 'year':
      return String(at.year);
    case 'quarter':
      return `${at.year}-Q${numberQuarterOf(at.month)}`;
    case 'month':
      return `${at.year}-${two(at.month)}`;
    case 'day':
      return `${at.year}-${two(at.month)}-${two(at.day)}`;
    case 'none':
      return '';
  }
}

/** Ключ счёта (PRIMARY KEY строки `number_counters` вместе с series_id):
 *  «id значений условий|период», пустые части не пишутся, без частей —
 *  'common'. Письмо-серии (сквозная × год) дают '2026' — формат живых
 *  строк прода #55, менять нельзя. Стабилен при переименовании (uuid). */
export function numberCountKey(containerIds: readonly string[], periodKey: string): string {
  const parts = [...containerIds, periodKey].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('|') : 'common';
}

/** Читатель поля-вставки: значение атрибута из источника сегмента. Нет
 *  читателя или атрибут удалён/пуст — пустая строка. */
export type NumberTemplateFieldReader = (segment: NumberFieldSegment) => string;

/** Поля-вставки, которые у этой записи пусты: выдача без подтверждения
 *  отказывает 409 `NUMBER_SEGMENT_EMPTY` (окно «выдать так / вернуться»). */
export function numberEmptySegments(
  template: readonly NumberTemplateSegment[],
  field: NumberTemplateFieldReader,
): NumberFieldSegment[] {
  return template.filter(
    (segment): segment is NumberFieldSegment =>
      segment.kind === 'field' && field(segment).trim().length === 0,
  );
}

/** Ввод рендера: момент передан ГОТОВЫМИ частями — пояс компании у каждого
 *  контекста свой, рендер остаётся чистым. */
export interface NumberTemplateRenderInput extends NumberMoment {
  seq: number;
  field?: NumberTemplateFieldReader;
}

/** Рендер номера: «Вх-2026/118», «15-26», «Изм. 3», «0412-7». */
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
      case 'quarter':
        out += String(numberQuarterOf(input.month));
        break;
      case 'month':
        out += two(input.month);
        break;
      case 'day':
        out += two(input.day);
        break;
      case 'field':
        out += input.field?.(segment) ?? '';
        break;
    }
  }
  return out;
}

/** Почему «при создании» нельзя включить этому виду записей (null — можно).
 *  Письмо создаёт и почта — без проекта, полей и человека, который ответит
 *  на «выдать с пустым полем?». Поэтому письму «при создании» — только
 *  сквозная нумерация (или по типу письма) без полей письма в номере;
 *  остальное выдаёт кнопка регистрации (вердикт владельца 08.11: письмо —
 *  «во время регистрации»). Импорт почты из-за счётчика не падает никогда. */
export function numberCreateTriggerProblem(
  rule: Pick<NumberSeriesRule, 'containers' | 'template'>,
  host: NumberHostKind,
): 'letter_place' | 'letter_fields' | null {
  if (host !== 'letter') return null;
  if (rule.containers.some((container: NumberContainer) => container.kind !== 'record_type')) {
    return 'letter_place';
  }
  if (rule.template.some((segment) => segment.kind === 'field' && segment.source !== 'company')) {
    return 'letter_fields';
  }
  return null;
}
