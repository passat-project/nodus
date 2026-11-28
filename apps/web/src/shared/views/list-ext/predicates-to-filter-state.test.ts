import { describe, expect, it } from 'vitest';
import type { ListFilter } from '@nodus/contracts';

import { predicatesToFilterState } from './predicates-to-filter-state.js';

describe('predicatesToFilterState — вид → панель (#435)', () => {
  it('stage_is и system_state возвращаются в родные поля журнала', () => {
    const filter: ListFilter = [
      { kind: 'stage_is', stageId: 'stage-1' },
      { kind: 'system_state', state: 'active' },
    ];
    expect(predicatesToFilterState(filter)).toEqual({ stage: 'stage-1', systemState: 'active' });
  });

  it('диапазон дат собирается обратно из gte/lte', () => {
    const field = 'cf.33333333-3333-4333-8333-333333333333';
    const filter: ListFilter = [
      { kind: 'field', field, op: 'gte', value: '2026-10-01' },
      { kind: 'field', field, op: 'lte', value: '2026-10-31T23:59:59.999' },
    ];
    expect(predicatesToFilterState(filter)).toEqual({
      [field]: { from: '2026-10-01', to: '2026-10-31' },
    });
  });

  it('enum eq и multienum in_any возвращаются выбором', () => {
    const enumField = 'cf.44444444-4444-4444-8444-444444444444';
    const multiField = 'cf.55555555-5555-4555-8555-555555555555';
    const filter: ListFilter = [
      { kind: 'field', field: enumField, op: 'eq', value: 'item-1' },
      { kind: 'field', field: multiField, op: 'in_any', value: ['item-2'] },
    ];
    expect(predicatesToFilterState(filter)).toEqual({
      [enumField]: 'item-1',
      [multiField]: 'item-2',
    });
  });

  it('bool eq true/false(null) возвращается выбором «да»/«нет»', () => {
    const field = 'cf.77777777-7777-4777-8777-777777777777';
    expect(predicatesToFilterState([{ kind: 'field', field, op: 'eq', value: true }])).toEqual({
      [field]: 'true',
    });
    expect(predicatesToFilterState([{ kind: 'field', field, op: 'eq', value: null }])).toEqual({
      [field]: 'false',
    });
  });

  it('type_is/outcome/result_issued панелью не представляются — пропускаются', () => {
    const filter: ListFilter = [{ kind: 'type_is', typeId: 't1' }, { kind: 'result_issued' }];
    expect(predicatesToFilterState(filter)).toEqual({});
  });
});
