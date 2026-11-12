// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LetterListItem, TaskListItem } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../auth-store.js';

// Тяжёлые справочники реестров фильтров — заглушками: тест про «Портфель».
vi.mock('../api/task-stages.js', () => ({ useTaskStages: () => ({ data: [] }) }));
vi.mock('../api/users-list.js', () => ({ useUsersList: () => ({ data: { items: [] } }) }));
vi.mock('../custom-fields/filter-defs.js', () => ({ useCustomFieldFilterDefs: () => [] }));
vi.mock('../custom-fields/queries.js', () => ({ customFieldValuesOf: () => ({}) }));

import { usePortfolioFilterDef } from './portfolio-filter-fields.js';
import { useLetterFilterDefs } from './letter-filter-fields.js';
import { useTaskFilterDefs } from './task-filter-fields.js';

/** Фильтр «Портфель» в списках задач и писем (#559): портфель — папка
 *  журнала «Проекты», фильтр появляется там же, где фильтр по проекту. */
const PORTFOLIO = '42000000-0000-4000-8000-000000000001';
const ARCHIVED_PORTFOLIO = '42000000-0000-4000-8000-000000000002';
const PROJECT = '10000000-0000-4000-8000-000000000001';
const NO_PORTFOLIO_PROJECT = '10000000-0000-4000-8000-000000000002';

const server = setupServer(
  http.get('/api/v1/projects/groups', () =>
    HttpResponse.json([
      { id: PORTFOLIO, name: 'Нежин-Недра', archivedAt: null },
      // Архивная папка тоже в опциях — иначе чип фильтра покажет uuid.
      { id: ARCHIVED_PORTFOLIO, name: 'Тендеры', archivedAt: '2026-11-01T10:00:00.000Z' },
    ]),
  ),
  http.get('/api/v1/projects', () =>
    HttpResponse.json({
      items: [
        {
          id: PROJECT,
          code: 'НН-1',
          name: 'Договор',
          portfolio: { id: PORTFOLIO, name: 'Нежин-Недра' },
        },
        // Проект без портфеля — строка папки «Без портфеля».
        { id: NO_PORTFOLIO_PROJECT, code: 'Т-1', name: 'Тема', portfolio: null },
      ],
      nextCursor: null,
    }),
  ),
);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function hook<T>(qc: QueryClient, fn: () => T) {
  return renderHook(fn, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

beforeAll(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    user: {
      id: '20000000-0000-4000-8000-000000000001',
      email: 'me@nodus.by',
      displayName: 'Я Первый',
      permissions: [],
      modules: ['projects'],
    },
  });
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('usePortfolioFilterDef (#559)', () => {
  it('варианты — живые портфели, архивные с пометкой и «Без портфеля»', async () => {
    const qc = makeClient();
    const { result } = hook(qc, () =>
      usePortfolioFilterDef<TaskListItem>({ projectIdOf: (task) => task.project?.id ?? null }),
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    const def = result.current!;
    expect(def.id).toBe('portfolio');
    expect(def.options?.map((option) => option.value)).toEqual([
      PORTFOLIO,
      ARCHIVED_PORTFOLIO,
      'none',
    ]);
    // Архивная папка в чипе читается названием, а не uuid-ом.
    expect(def.options?.find((option) => option.value === ARCHIVED_PORTFOLIO)?.label).toBe(
      'Тендеры (архив)',
    );

    const inPortfolio = { project: { id: PROJECT, code: 'НН-1', name: 'Договор' } } as TaskListItem;
    const withoutPortfolio = {
      project: { id: NO_PORTFOLIO_PROJECT, code: 'Т-1', name: 'Тема' },
    } as TaskListItem;
    expect(def.match(inPortfolio, PORTFOLIO)).toBe(true);
    expect(def.match(inPortfolio, 'none')).toBe(false);
    expect(def.match(withoutPortfolio, 'none')).toBe(true);
  });

  it('без справочников фильтра нет — панель не показывает пустой «Портфель»', async () => {
    server.use(http.get('/api/v1/projects/groups', () => HttpResponse.json([])));
    const qc = makeClient();
    const { result } = hook(qc, () =>
      usePortfolioFilterDef<TaskListItem>({ projectIdOf: () => null }),
    );

    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe('списки задач и писем (#559)', () => {
  it('в реестре фильтров задач появился «Портфель»', async () => {
    const qc = makeClient();
    const { result } = hook(qc, () => useTaskFilterDefs());

    await waitFor(() => expect(result.current.some((def) => def.id === 'portfolio')).toBe(true));
    const def = result.current.find((item) => item.id === 'portfolio')!;
    expect(def.label).toBe('Портфель');
  });

  it('в реестре фильтров писем появился «Портфель»', async () => {
    const qc = makeClient();
    const rows = [
      {
        project: { id: PROJECT, code: 'НН-1', name: 'Договор' },
        stage: { name: 'Входящее', order: 1 },
      },
    ] as unknown as LetterListItem[];
    const { result } = hook(qc, () => useLetterFilterDefs(rows));

    await waitFor(() => expect(result.current.some((def) => def.id === 'portfolio')).toBe(true));
  });

  it('в карточке проекта фильтр скрыт вместе с фильтром по проекту', async () => {
    const qc = makeClient();
    const { result } = hook(qc, () => useTaskFilterDefs({ projectVisible: false }));

    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.some((def) => def.id === 'portfolio')).toBe(false);
  });
});
