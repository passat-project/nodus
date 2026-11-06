import { describe, expect, it } from 'vitest';
import type { CreationFieldSlot, CustomFieldDefinition } from '@nodus/contracts';

import { slotSummary, type SlotSummaryContext } from './creation-slot-summary.js';

/** Сводка строки поля «Окна создания» (#432): вид поля, «обязательно»,
 *  скрытое значение человеческим текстом — без id. */

const FIELD_ID = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';
const USER_C = '44444444-4444-4444-8444-444444444444';

const slot = (over: Partial<CreationFieldSlot>): CreationFieldSlot => ({
  key: 'description',
  label: null,
  required: false,
  preset: null,
  ...over,
});

const definition = (type: CustomFieldDefinition['type']): CustomFieldDefinition => ({
  id: FIELD_ID,
  number: 1,
  type,
  name: 'Часы переработки',
  hint: null,
  settings: { precision: 1 },
  dictionary: null,
  defaultValue: null,
  defaultRefs: [],
  reportIndexed: false,
  isCompany: false,
  companyValue: null,
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
  sortOrder: 0,
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
});

const names: Record<string, string> = {
  [USER_A]: 'Климович П.',
  [USER_B]: 'Иванова А.',
  [USER_C]: 'Петров С.',
};
const ctx = (over: Partial<SlotSummaryContext> = {}): SlotSummaryContext => ({
  userName: (id) => names[id],
  projectName: () => 'ЖК «Сокол»',
  ...over,
});

describe('slotSummary', () => {
  it('системное и атрибут — вид поля; обязательное — «· обязательно»', () => {
    expect(slotSummary(slot({}), ctx())).toBe('Системное поле');
    expect(slotSummary(slot({ required: true }), ctx())).toBe('Системное поле · обязательно');
    const key = `cf.${FIELD_ID}` as const;
    expect(slotSummary(slot({ key }), ctx({ definition: definition('date') }))).toBe('Дата');
    expect(slotSummary(slot({ key }), ctx())).toBe('Атрибут удалён');
  });

  it('скрытое значение — текстом: приоритет, сотрудники, проект', () => {
    expect(slotSummary(slot({ key: 'priority', preset: 'high' }), ctx())).toBe('Скрыто: Высокий');
    expect(slotSummary(slot({ key: 'assignee', preset: USER_A }), ctx())).toBe(
      'Скрыто: Климович П.',
    );
    expect(slotSummary(slot({ key: 'observers', preset: [USER_A, USER_B, USER_C] }), ctx())).toBe(
      'Скрыто: Климович П., Иванова А. +1',
    );
    expect(slotSummary(slot({ key: 'project', preset: FIELD_ID }), ctx())).toBe(
      'Скрыто: ЖК «Сокол»',
    );
  });

  it('скрытое значение ещё не выбрано — так и написано', () => {
    expect(slotSummary(slot({ preset: '' }), ctx())).toBe('Скрыто: значение не выбрано');
    expect(slotSummary(slot({ key: 'observers', preset: [] }), ctx())).toBe(
      'Скрыто: значение не выбрано',
    );
  });

  it('атрибут: число по точности определения, длинный текст обрезан', () => {
    const key = `cf.${FIELD_ID}` as const;
    expect(slotSummary(slot({ key, preset: 4 }), ctx({ definition: definition('number') }))).toBe(
      'Скрыто: 4,0',
    );
    const long = 'Очень длинная причина переработки, которая не помещается в строку';
    const summary = slotSummary(slot({ preset: long }), ctx());
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThan(long.length);
  });
});
