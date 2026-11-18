// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ProcessType } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useAliveProcessTypes, useCreatableProcessTypes } from './process-types-api.js';

/** Задачные хуки типов процессов (#428, ADR-0024): сервер фильтруется
 *  `category=task`, клиент дополнительно отсекает чужие категории. */
const server = setupServer();

const type = (id: string, category: 'task' | 'letter', creatable = true): ProcessType => ({
  id,
  code: id,
  name: id,
  category,
  direction: category === 'letter' ? 'incoming' : null,
  icon: 'square-check',
  color: 'neutral',
  description: '',
  creatable,
  isSystem: false,
  sortOrder: 0,
  archivedAt: null,
  workflowId: `wf-${id}`,
  numbering: null,
  config: {
    card: { hiddenBlocks: [], roleLabels: {} },
    access: { view: null, create: null },
    creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
  },
  creationForm: { fields: [], chips: [] },
  viewer: { canView: true, canCreate: true },
});

function hook<T>(use: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(use, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('Задачные хуки типов процессов (#428)', () => {
  it('useCreatableProcessTypes: только задачи и только creatable; запрос с category=task', async () => {
    let requested = '';
    server.use(
      http.get('/api/v1/workflows/types', ({ request }) => {
        requested = new URL(request.url).searchParams.get('category') ?? '';
        return HttpResponse.json([
          type('task-a', 'task'),
          type('task-hidden', 'task', false),
          type('letter-a', 'letter'),
        ]);
      }),
    );
    server.listen();
    const { result } = hook(() => useCreatableProcessTypes());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested).toBe('task');
    expect(result.current.data?.map((t) => t.id)).toEqual(['task-a']);
    server.close();
  });

  it('useAliveProcessTypes: архивные и чужие категории отсекаются', async () => {
    server.use(
      http.get('/api/v1/workflows/types', () =>
        HttpResponse.json([
          type('task-a', 'task'),
          { ...type('task-old', 'task'), archivedAt: '2026-10-01T10:00:00Z' },
          type('letter-a', 'letter'),
        ]),
      ),
    );
    server.listen();
    const { result } = hook(() => useAliveProcessTypes());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((t) => t.id)).toEqual(['task-a']);
    server.close();
  });
});
