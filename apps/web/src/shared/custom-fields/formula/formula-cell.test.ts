import { describe, expect, it } from 'vitest';

import { formulaCellFrozen } from './formula-cell.js';

describe('formulaCellFrozen: ячейка с формулой не редактируется (#632)', () => {
  it('своя формула заморожена', () => expect(formulaCellFrozen('own')).toBe(true));
  it('формула типа заморожена сразу, без сохранения', () =>
    expect(formulaCellFrozen('type')).toBe(true));
  it('значение, подавившее формулу типа, редактируется', () =>
    expect(formulaCellFrozen('value')).toBe(false));
  it('ячейка без формулы редактируется', () => expect(formulaCellFrozen(null)).toBe(false));
});
