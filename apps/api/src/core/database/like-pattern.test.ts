import { describe, expect, it } from 'vitest';

import { escapeLikePattern } from './like-pattern.js';

describe('escapeLikePattern (#952 F1)', () => {
  it('метасимволы LIKE становятся литералами', () => {
    expect(escapeLikePattern('%')).toBe('\\%');
    expect(escapeLikePattern('_')).toBe('\\_');
    expect(escapeLikePattern('a%b_c')).toBe('a\\%b\\_c');
  });

  it('обратный слэш экранируется первым', () => {
    expect(escapeLikePattern('\\')).toBe('\\\\');
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('обычный текст не меняется', () => {
    expect(escapeLikePattern('Вх-2026/431')).toBe('Вх-2026/431');
    expect(escapeLikePattern('ПП-123')).toBe('ПП-123');
  });
});
