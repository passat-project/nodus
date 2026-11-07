import { describe, expect, it } from 'vitest';

import { formulaPlaceRejection } from './formula-cells.policy.js';

const definition = (isCompany: boolean, targetIds: string[]) => ({
  isCompany,
  bindings: targetIds.map((targetId) => ({
    targetKind: 'process_type',
    targetId,
    defaultFormula: null,
  })),
});

describe('formulaPlaceRejection: ядовитая ячейка без регрессии (#632)', () => {
  it('глобальный атрибут отклоняется — у него нет места', () => {
    expect(formulaPlaceRejection(definition(true, []), 'type-1')?.code).toBe(
      'attribute_unavailable',
    );
  });

  it('атрибут, привязанный только к другому типу, отклоняется', () => {
    expect(formulaPlaceRejection(definition(false, ['type-2']), 'type-1')?.code).toBe(
      'attribute_unavailable',
    );
  });

  it('валидная привязка к месту хоста разрешает сохранение (R4)', () => {
    expect(formulaPlaceRejection(definition(false, ['type-1', 'type-2']), 'type-1')).toBeNull();
  });

  it('без привязок вовсе — fail-open: судить нельзя', () => {
    expect(formulaPlaceRejection(definition(false, []), 'type-1')).toBeNull();
  });

  it('хост без места — fail-open', () => {
    expect(formulaPlaceRejection(definition(false, ['type-2']), null)).toBeNull();
  });
});
