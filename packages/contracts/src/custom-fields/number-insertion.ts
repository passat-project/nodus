import type { NumberSeriesRule } from '../workflows/number-series.schemas.js';

/**
 * Печатные вставки номера (#630, AUD-010, #866) — ОДИН закрытый список для
 * сервера, интерфейса и демо-моков (ADR-0001 «мок ≠ контракт = баг»).
 *
 * Номер документа неизменяем после выдачи и обязан нести печатное значение, а
 * не внутренний идентификатор: текст печатается как есть, число и
 * продолжительность — строкой числа, список — кодом варианта. У ссылок, денег,
 * даты, флагов и составных типов печатного вида нет — правило с такой вставкой
 * не сохраняется (422 `NUMBER_SEGMENT_UNSUPPORTED`), а палитра выбора поля в
 * интерфейсе их не предлагает.
 */
export const NUMBER_INSERTION_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'duration',
  'enum',
] as const;

export type NumberInsertionFieldType = (typeof NUMBER_INSERTION_FIELD_TYPES)[number];

const PRINTABLE: ReadonlySet<string> = new Set(NUMBER_INSERTION_FIELD_TYPES);

/** Есть ли у типа поля печатное значение для номера. */
export function isNumberInsertionType(type: string): boolean {
  return PRINTABLE.has(type);
}

/** Минимум сведений об атрибуте для проверки правила (строка определения и
 *  ответ API одинаково подходят). */
export interface NumberInsertionDefinitionRef {
  number: number;
  name: string;
  type: string;
}

export interface NumberInsertionProblem {
  fieldNumber: number;
  name: string;
  type: string;
}

/**
 * Печатное значение вставки по типу поля — ОДНА грамматика для выдачи,
 * превью и демо-моков. `codeOf` даёт печатную строку варианта списка (код, без
 * кода — подпись); мёртвый вариант и любое несовместимое значение дают пустую
 * строку, а не внутренний id.
 */
export function numberInsertionText(
  type: string,
  raw: unknown,
  codeOf?: (id: string) => string | undefined,
): string {
  if (raw === null || raw === undefined) return '';
  switch (type) {
    case 'text':
    case 'long_text':
      return typeof raw === 'string' ? raw : '';
    case 'number':
    case 'duration':
      return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
    case 'enum':
      return typeof raw === 'string' && raw.length > 0 ? (codeOf?.(raw) ?? '') : '';
    default:
      return '';
  }
}

/**
 * Вставки правила без печатного значения — в порядке шаблона. Пустой массив —
 * правило сохранимо. Неизвестный номер поля считается проблемой (`missing`):
 * ссылка на удалённый атрибут не должна проходить молча.
 */
export function unsupportedNumberInsertions(
  rule: Pick<NumberSeriesRule, 'template'>,
  definitions: readonly NumberInsertionDefinitionRef[],
): NumberInsertionProblem[] {
  const byNumber = new Map(definitions.map((definition) => [definition.number, definition]));
  const problems: NumberInsertionProblem[] = [];
  for (const segment of rule.template) {
    if (segment.kind !== 'field') continue;
    const definition = byNumber.get(segment.fieldNumber);
    if (definition && isNumberInsertionType(definition.type)) continue;
    problems.push({
      fieldNumber: segment.fieldNumber,
      name: definition?.name ?? '—',
      type: definition?.type ?? 'missing',
    });
  }
  return problems;
}
