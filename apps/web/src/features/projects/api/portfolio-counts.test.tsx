// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectPortfolioCount } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useProjectPortfolioCounts } from './portfolio-counts.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';

/** Счётчики папок (#559): тот же режим «Все / Мои», что у журнала — иначе
 *  колонка показывает чужие договоры, когда список сужен до моего участия. */
const COUNTS: ProjectPortfolioCount[] = [
  { portfolioId: '42000000-0000-4000-8000-000000000001', active: 2, completed: 0, archived: 0 },
  { portfolioId: null, active: 1, completed: 0, archived: 0 },
];

const server = setupServer();
const requested: string[] = [];

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.use(
    http.get('/api/v1/projects/groups/counts', ({ request }) => {
      requested.push(new URL(request.url).search);
      return HttpResponse.json(COUNTS);
    }),
  );
});
afterEach(() => {
  requested.length = 0;
});
afterAll(() => server.close());

describe('useProjectPortfolioCounts (#559)', () => {
  it('scope=mine уходит параметром и живёт отдельным ключом кэша', async () => {
    const qc = makeClient();
    const { result } = renderHook(() => useProjectPortfolioCounts('mine'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await waitFor(() => expect(result.current.data).toEqual(COUNTS));
    expect(requested).toEqual(['?scope=mine']);
    // Ключи «Все» и «Мои» разные — переключение не отдаёт чужие цифры.
    expect(projectsKeys.groupCounts('mine')).not.toEqual(projectsKeys.groupCounts('all'));
  });
});
