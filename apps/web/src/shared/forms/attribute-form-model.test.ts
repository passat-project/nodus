import { describe, expect, it } from 'vitest';
import type { AttributeElement } from './attribute-form-model.js';

import {
  attributeFieldKey,
  attributeFromBuilder,
  attributeSystemKey,
  attributeToBuilder,
  fieldIdOfAttributeKey,
  isSlotElement,
  systemKeyOfAttributeKey,
} from './attribute-form-model.js';

/** Форма атрибутов места ↔ редактор окна (#496): ключи, обратный перевод,
 *  системные строки и оформление. */

const FIELD_ID = 'c0000000-0000-4000-8000-0000000000e1';
const MISSING_ID = 'c0000000-0000-4000-8000-0000000000e9';

describe('форма атрибутов: ключи и перевод', () => {
  it('ключи слотов и системных строк разбираются обратно', () => {
    expect(attributeFieldKey(FIELD_ID)).toBe(`field:${FIELD_ID}`);
    expect(attributeSystemKey('manager')).toBe('system:manager');
    expect(fieldIdOfAttributeKey(`field:${FIELD_ID}`)).toBe(FIELD_ID);
    expect(fieldIdOfAttributeKey('system:manager')).toBeNull();
    expect(systemKeyOfAttributeKey('system:manager')).toBe('manager');
    expect(systemKeyOfAttributeKey(`field:${FIELD_ID}`)).toBeNull();
  });

  it('слот, системная строка и оформление — туда и обратно без потерь', () => {
    const elements: AttributeElement[] = [
      {
        fieldId: FIELD_ID,
        state: 'required',
        label: 'Шифр',
        hint: 'По договору',
        width: 'half',
        height: 'lines',
        formula: { kind: 'literal', value: 'x' } as never,
      },
      { kind: 'system', key: 'manager', label: 'Ответственный', width: 'half' },
      { kind: 'heading', id: 'dhead001', text: 'Реквизиты' },
      { kind: 'gap', id: 'dgap0001' },
    ];

    const value = attributeToBuilder(elements);
    expect(value.locks).toEqual([]);
    expect(value.items[0]).toMatchObject({
      kind: 'field',
      key: `field:${FIELD_ID}`,
      label: 'Шифр',
      hint: 'По договору',
      width: 'half',
      height: 'lines',
      extra: { state: 'required' },
    });

    expect(attributeFromBuilder(value)).toEqual(elements);
  });

  it('неизвестный ключ не выдумывает элемент; слот распознаётся', () => {
    const value = attributeToBuilder([{ fieldId: MISSING_ID, state: 'hidden' }]);
    const broken = {
      items: [...value.items, { kind: 'field' as const, key: 'weird', extra: {} }],
      locks: [],
    };
    expect(attributeFromBuilder(broken as never)).toEqual([
      { fieldId: MISSING_ID, state: 'hidden', label: null },
    ]);
    expect(isSlotElement({ fieldId: MISSING_ID, state: 'hidden' })).toBe(true);
    expect(isSlotElement({ kind: 'system', key: 'manager' })).toBe(false);
  });
});
