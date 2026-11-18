import { describe, expect, it } from 'vitest';

import { searchPath, searchRequestOf } from './search-api.js';

describe('запрос поиска: стор → wire (#952)', () => {
  it('period переводится в from по UTC-дню, types — строкой через запятую', () => {
    const request = searchRequestOf({
      q: '  труба  ',
      types: ['task', 'letter'],
      projectId: '40000000-0000-4000-8000-000000000001',
      period: 'week',
      sort: 'newest',
    });
    expect(request.q).toBe('труба');
    expect(request.types).toEqual(['task', 'letter']);
    expect(request.sort).toBe('newest');
    expect(request.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const params = new URLSearchParams(searchPath(request).split('?')[1]);
    expect(params.get('types')).toBe('task,letter');
    expect(params.get('projectId')).toBe('40000000-0000-4000-8000-000000000001');
    expect(params.get('sort')).toBe('newest');
    expect(params.get('limit')).toBe('20');
  });

  it('без фильтров — только q, sort и limit', () => {
    const params = new URLSearchParams(searchPath(searchRequestOf({ q: 'смета' })).split('?')[1]);
    expect([...params.keys()].sort()).toEqual(['limit', 'q', 'sort']);
    expect(params.get('q')).toBe('смета');
    expect(params.get('from')).toBeNull();
  });

  it('cursor попадает в путь только при листании', () => {
    const request = searchRequestOf({ q: 'смета' });
    expect(searchPath({ ...request, cursor: '20' })).toContain('cursor=20');
  });
});
