// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectGroup } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useProjectFilterDefs } from './project-filter-fields.js';

/** Портфель в реестре фильтров журнала (#559): поле живёт в панели и в
 *  пресетах (сохранённый фильтр несёт папку), но чипом в строке поиска не
 *  показывается — имя выбранной папки носит кнопка «Портфели» (13.11.2026).
 *  Архива у папки нет: опции — справочник и «Без портфеля». */
const PORTFOLIO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
};
const SECOND: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000002',
  name: 'Старый объект',
};

const urls: string[] = [];
const server = setupServer(
  http.get('/api/v1/projects/groups', ({ request }) => {
    urls.push(request.url);
    return HttpResponse.json([PORTFOLIO, SECOND]);
  }),
);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function hookDefs() {
  const qc = makeClient();
  return renderHook(() => useProjectFilterDefs(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  urls.length = 0;
});
afterAll(() => server.close());

describe('useProjectFilterDefs: поле «Портфель» (#559)', () => {
  it('поле есть: портфели справочника и «Без портфеля», без режима «с архивом»', async () => {
    const { result } = hookDefs();

    await waitFor(() => {
      const def = result.current.find((item) => item.id === 'portfolio');
      expect(def?.options).toHaveLength(3);
    });
    const def = result.current.find((item) => item.id === 'portfolio')!;
    expect(def.options?.map((option) => option.value)).toEqual([PORTFOLIO.id, SECOND.id, 'none']);
    expect(def.options?.map((option) => option.label)).toEqual([
      'Нежин-Недра',
      'Старый объект',
      'Без портфеля',
    ]);
    // Архивных папок больше нет — параметр includeArchived не запрашивается.
    expect(urls.every((url) => !url.includes('includeArchived'))).toBe(true);
  });

  it('match: `none` — проекты без портфеля, папка — свои', async () => {
    const { result } = hookDefs();
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    const def = result.current.find((item) => item.id === 'portfolio')!;

    const withoutPortfolio = { portfolio: null } as never;
    const inPortfolio = { portfolio: { id: PORTFOLIO.id, name: PORTFOLIO.name } } as never;
    expect(def.match(withoutPortfolio, 'none')).toBe(true);
    expect(def.match(withoutPortfolio, PORTFOLIO.id)).toBe(false);
    expect(def.match(inPortfolio, PORTFOLIO.id)).toBe(true);
  });

  it('остальные журнальные фильтры на месте: роль, видимость, статус', async () => {
    const { result } = hookDefs();
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));

    expect(result.current.map((def) => def.id)).toEqual([
      'portfolio',
      'role',
      'visibility',
      'status',
    ]);
  });
});
