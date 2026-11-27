import type { CustomFieldDefinition, CustomFieldValue } from '@nodus/contracts';
import { readCustomFieldValue } from '@nodus/contracts';

import type { ListCfDef } from './list-ext-sql.js';

/**
 * Значение атрибута в выгрузке CSV (#435): человекочитаемо — ссылки по именам
 * (резолвер передаёт вызывающий: имена уже проверены на видимость актора),
 * массивы через запятую, деньги — суммой. Чистая функция над сырым JSONB.
 */

export interface CfFormatLabels {
  true: string;
  false: string;
}

/** Значение → ячейка CSV (string | number | null). `refs` — id → имя. */
export function formatCfValue(
  def: Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>,
  raw: unknown,
  refs: ReadonlyMap<string, string | null>,
  labels: CfFormatLabels,
): string | number | null {
  if (raw === null || raw === undefined) return null;
  switch (def.type) {
    case 'number':
    case 'duration':
      return typeof raw === 'number' ? raw : readable(raw, refs, labels);
    case 'money':
      // Валюта в CSV не печатается (единая валюта портала); сумма — числом.
      return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? Number((raw as { amount: unknown }).amount ?? null) || null
        : null;
    case 'bool':
      return raw === true ? labels.true : labels.false;
    case 'enum':
    case 'user':
    case 'department':
    case 'project':
    case 'counterparty':
    case 'task':
    case 'letter':
    case 'node':
      return nameOf(raw, refs);
    case 'multienum':
    case 'users': {
      // Толерантное чтение (Р3): скаляр — как массив одного элемента.
      const value = readCustomFieldValue(def as ListCfDef, raw);
      const items = Array.isArray(value) ? value : value !== undefined ? [value] : [];
      const names = items.map((item) => nameOf(item, refs)).filter((n): n is string => n !== null);
      return names.length > 0 ? names.join(', ') : null;
    }
    default:
      return readable(raw, refs, labels);
  }
}

function nameOf(raw: unknown, refs: ReadonlyMap<string, string | null>): string | null {
  if (typeof raw !== 'string') return null;
  return refs.get(raw) ?? null;
}

function readable(
  raw: unknown,
  refs: ReadonlyMap<string, string | null>,
  labels: CfFormatLabels,
): string | number | null {
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? labels.true : labels.false;
  if (Array.isArray(raw)) {
    const names = raw
      .map((item) => (typeof item === 'string' ? (refs.get(item) ?? item) : String(item)))
      .filter((item) => item !== '');
    return names.length > 0 ? names.join(', ') : null;
  }
  void labels;
  return null;
}

/** Значения атрибутов строки (JSONB) — плоская карта по id определения. */
export type CfValuesRow = Record<string, CustomFieldValue | undefined>;
