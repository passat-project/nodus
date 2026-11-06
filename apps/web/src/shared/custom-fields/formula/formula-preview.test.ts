import { describe, expect, it } from 'vitest';

import { cleanFormulaText, previewText } from './formula-preview.js';

describe('cleanFormulaText: пустые операнды не оставляют дефисов (#632)', () => {
  it('двойной дефис и типографские маркеры убираются', () => {
    expect(cleanFormulaText('2026-42--')).toBe('2026-42');
    expect(cleanFormulaText('2026-42—')).toBe('2026-42');
    expect(cleanFormulaText('2026-42−')).toBe('2026-42');
  });
  it('нормальный шифр не меняется', () => {
    expect(cleanFormulaText('0359-1-КЖ1')).toBe('0359-1-КЖ1');
  });
  it('пустая строка — пустое значение', () => {
    expect(cleanFormulaText('—')).toBeNull();
  });
});

describe('previewText: пример в редакторе без пустых дефисов (#632)', () => {
  it('2026-42-- показывается как 2026-42', () => {
    expect(
      previewText('2026-42--', {
        type: 'text',
        settings: {},
      } as never),
    ).toBe('2026-42');
  });
});
