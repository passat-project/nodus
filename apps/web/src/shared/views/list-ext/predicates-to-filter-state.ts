import type { ConditionFieldOp, ListFilter } from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

import type { FilterState } from '../list-filters.js';

/**
 * Обратный перевод предикатов вида в значения панели (#435): применённый вид
 * показывает свои условия родными контролами панели (чипы, диапазоны).
 * Покрывает всё, что панель умеет создавать (поля-атрибуты, статус,
 * системное состояние); type_is/outcome/result_issued в панели представления
 * не имеют — остаются только в запросе вида (вкладка проекта шлёт фильтр вида
 * напрямую, без растраты).
 */

interface FieldParts {
  op?: ConditionFieldOp;
  value?: unknown;
  from?: unknown;
  to?: unknown;
}

export function predicatesToFilterState(filter: ListFilter): FilterState {
  const parts = new Map<string, FieldParts>();
  const state: FilterState = {};
  for (const predicate of filter) {
    if (predicate.kind === 'stage_is') {
      state.stage = predicate.stageId;
      continue;
    }
    if (predicate.kind === 'system_state') {
      state.systemState = predicate.state;
      continue;
    }
    if (predicate.kind !== 'field') continue;
    const current = parts.get(predicate.field) ?? {};
    if (predicate.op === 'gte' || predicate.op === 'lte') {
      // Диапазон — ПАРОЙ предикатов одного поля: границы копятся отдельно
      // (вторая не затирает первую).
      const value = predicate.value;
      const isDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
      const bound = isDate ? String(value).slice(0, 10) : value;
      if (predicate.op === 'gte') current.from = bound;
      else current.to = bound;
    } else {
      current.op = predicate.op;
      if ('value' in predicate) current.value = predicate.value;
    }
    parts.set(predicate.field, current);
  }
  for (const [field, part] of parts) {
    if (customFieldIdOfKey(field) === null) continue;
    if (part.from !== undefined || part.to !== undefined) {
      const range: { from?: unknown; to?: unknown } = {};
      if (part.from !== undefined) range.from = part.from;
      if (part.to !== undefined) range.to = part.to;
      state[field] = range as FilterState[string];
      continue;
    }
    switch (part.op) {
      case 'contains':
        if (typeof part.value === 'string') state[field] = part.value;
        break;
      case 'eq':
        if (part.value === null)
          state[field] = 'false'; // eq null = «не заполнено»
        else if (part.value === true) state[field] = 'true';
        else if (typeof part.value === 'string' || typeof part.value === 'number')
          state[field] = String(part.value);
        break;
      case 'in_any':
        if (Array.isArray(part.value) && typeof part.value[0] === 'string')
          state[field] = part.value[0];
        break;
      default:
        break;
    }
  }
  return state;
}
