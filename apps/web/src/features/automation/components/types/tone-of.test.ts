import { describe, expect, it } from 'vitest';

import { toneOf } from './tone-of.js';

describe('тон плитки типа (#665, общий канон)', () => {
  it('цвет типа → токены темы', () => {
    expect(toneOf('info')).toContain('text-info');
    expect(toneOf('neutral')).toContain('bg-muted');
  });
});
