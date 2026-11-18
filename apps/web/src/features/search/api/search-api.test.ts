import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import type { SearchHit, SearchResponse } from '@nodus/contracts';

import { searchHits, searchPath, searchRequestOf } from './search-api.js';

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

  it('conversationId попадает в путь поиска внутри чата (#956)', () => {
    const request = {
      ...searchRequestOf({ q: 'смета', types: ['message'], sort: 'newest' }),
      conversationId: '8f1c1c1e-5a0f-4f2a-9d2e-3b7a6c1d0e11',
    };
    const params = new URLSearchParams(searchPath(request).split('?')[1]);
    expect(params.get('conversationId')).toBe('8f1c1c1e-5a0f-4f2a-9d2e-3b7a6c1d0e11');
    expect(params.get('types')).toBe('message');
  });

  it('страницы склеиваются без повторов type:id (граница курсора)', () => {
    const hit = (id: string, type: 'task' | 'letter') =>
      ({
        id,
        type,
        title: id,
        snippet: '',
        score: 0.5,
        match: 'exact',
        reasons: ['title'],
        sourceCreatedAt: '2026-11-10T09:00:00.000Z',
        meta: {},
      }) as unknown as SearchHit;
    const data = {
      pages: [
        { items: [hit('a', 'task'), hit('b', 'letter')] },
        { items: [hit('b', 'letter'), hit('c', 'task')] },
      ],
      pageParams: [null, 'cursor'],
    } as unknown as InfiniteData<SearchResponse>;
    expect(searchHits(data).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
