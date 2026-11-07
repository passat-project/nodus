import { describe, expect, it } from 'vitest';

import { numberSeriesRuleSchema } from './number-series.schemas.js';

const RULE = {
  scopeKind: 'none',
  period: 'year',
  template: [
    { kind: 'literal', text: 'Вх' },
    { kind: 'literal', text: '-' },
    { kind: 'year', digits: 4 },
    { kind: 'literal', text: '/' },
    { kind: 'counter' },
  ],
  startValue: 1,
} as const;

describe('numberSeriesRuleSchema (#630, Р2)', () => {
  it('письмо-правило «Вх-ГГГГ/N» валидно (backfill бит-в-бит)', () => {
    expect(numberSeriesRuleSchema.parse(RULE)).toEqual({ ...RULE });
  });

  it('шаблон без сегмента counter не сохраняется', () => {
    expect(
      numberSeriesRuleSchema.safeParse({
        ...RULE,
        template: [{ kind: 'literal', text: 'Книга' }],
      }).success,
    ).toBe(false);
  });

  it('два counter-сегмента — тоже отказ (ровно один)', () => {
    expect(
      numberSeriesRuleSchema.safeParse({
        ...RULE,
        template: [...RULE.template, { kind: 'counter', minLength: 3 }],
      }).success,
    ).toBe(false);
  });

  it('формула разреза обязательна при scopeKind=formula и запрещена иначе', () => {
    const ast = { kind: 'literal', value: 'ОВ1' };
    expect(numberSeriesRuleSchema.safeParse({ ...RULE, scopeKind: 'formula' }).success).toBe(false);
    expect(
      numberSeriesRuleSchema.safeParse({ ...RULE, scopeKind: 'formula', scopeFormula: ast })
        .success,
    ).toBe(true);
    expect(
      numberSeriesRuleSchema.safeParse({ ...RULE, scopeKind: 'folder', scopeFormula: ast }).success,
    ).toBe(false);
  });

  it('добивка и год 2 цифры — валидные сегменты (книга изменений «15-26»)', () => {
    expect(
      numberSeriesRuleSchema.safeParse({
        scopeKind: 'none',
        period: 'year',
        template: [
          { kind: 'counter', minLength: 2 },
          { kind: 'literal', text: '-' },
          { kind: 'year', digits: 2 },
        ],
        startValue: 15,
      }).success,
    ).toBe(true);
  });

  it('старт меньше 1 и пустой шаблон — отказ', () => {
    expect(numberSeriesRuleSchema.safeParse({ ...RULE, startValue: 0 }).success).toBe(false);
    expect(numberSeriesRuleSchema.safeParse({ ...RULE, template: [] }).success).toBe(false);
  });
});
