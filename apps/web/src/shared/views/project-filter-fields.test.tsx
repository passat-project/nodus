// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectGroup } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { filterValueLabel } from './list-filters.js';
import { useProjectFilterDefs } from './project-filter-fields.js';

/** Фильтр журнала проектов (#559): архивная папка в опциях читается
 *  названием с пометкой, а не uuid-ом в чипе. */
const PORTFOLIO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  archivedAt: null,
};
const ARCHIVED: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000002',
  name: 'Старый объект',
  archivedAt: '2026-11-01T10:00:00.000Z',
};

const urls: string[] = [];
const server = setupServer(
  http.get('/api/v1/projects/groups', ({ request }) => {
    urls.push(request.url);
    return HttpResponse.json([PORTFOLIO, ARCHIVED]);
  }),
);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  urls.length = 0;
});
afterAll(() => server.close());

describe('useProjectFilterDefs: портфель-папка (#559)', () => {
  it('живые папки, архивные с пометкой и «Без портфеля»; справочник с архивом', async () => {
    const qc = makeClient();
    const { result } = renderHook(() => useProjectFilterDefs(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await waitFor(() => {
      const def = result.current.find((item) => item.id === 'portfolio');
      expect(def?.options).toHaveLength(3);
    });
    const def = result.current.find((item) => item.id === 'portfolio')!;
    expect(def.options?.map((option) => option.value)).toEqual([PORTFOLIO.id, ARCHIVED.id, 'none']);
    // Архив запрошен: выбранная архивная папка иначе дала бы uuid в чипе.
    expect(urls.some((url) => url.includes('includeArchived=true'))).toBe(true);

    // Чип фильтра: название (архив), а не идентификатор.
    expect(filterValueLabel(def, ARCHIVED.id)).toBe('Старый объект (архив)');
    expect(filterValueLabel(def, 'none')).toBe('Без портфеля');
  });

  it('match: `none` — проекты без портфеля, папка — свои', async () => {
    const qc = makeClient();
    const { result } = renderHook(() => useProjectFilterDefs(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    const def = result.current.find((item) => item.id === 'portfolio')!;

    const withoutPortfolio = { portfolio: null } as never;
    const inPortfolio = { portfolio: { id: PORTFOLIO.id, name: PORTFOLIO.name } } as never;
    expect(def.match(withoutPortfolio, 'none')).toBe(true);
    expect(def.match(withoutPortfolio, PORTFOLIO.id)).toBe(false);
    expect(def.match(inPortfolio, PORTFOLIO.id)).toBe(true);
  });
});
