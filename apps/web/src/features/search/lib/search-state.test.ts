import { describe, expect, it } from 'vitest';

import { searchQueryReady } from './search-state.js';

describe('состояние окна поиска (#952)', () => {
  it('порог запроса — 2 непробельных символа', () => {
    expect(searchQueryReady('')).toBe(false);
    expect(searchQueryReady('   ')).toBe(false);
    expect(searchQueryReady('  п ')).toBe(false);
    expect(searchQueryReady('пп')).toBe(true);
    expect(searchQueryReady(' пп ')).toBe(true);
  });
});
