// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ProcessType } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { automationKeys } from '../../../shared/api/automation-keys.js';
import { workflowKeys } from '../../../shared/workflow/workflow-api.js';
import { useStageNames, useUpdateProcessType } from './automation-api.js';

/** Детерминированный тест оптимистичной правки свойств типа (I4, #378):
 *  creatable меняется в кэше ДО ответа сервера (контролируемый deferred);
 *  ошибка сервера откатывает снапшот. */
const server = setupServer();

const makeType = (n: string): ProcessType => ({
  id: `00000000-0000-4000-8000-0000000000c${n}`,
  code: 'task',
  name: 'Стандартный',
  icon: 'square-check',
  color: 'neutral',
  description: '',
  creatable: false,
  category: 'task',
  direction: null,
  isSystem: true,
  sortOrder: 0,
  archivedAt: null,
  workflowId: `00000000-0000-4000-8000-0000000000d${n}`,
  config: {
    card: { hiddenBlocks: [], roleLabels: {} },
    access: { view: null, create: null },
  },
  creationForm: { fields: [], chips: [] },
  viewer: { canView: true, canCreate: true },
  numbering: null,
});

function hook(client: QueryClient) {
  return renderHook(() => useUpdateProcessType(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('useUpdateProcessType: оптимистичность (#378)', () => {
  it('creatable применяется до ответа сервера и подтверждается', async () => {
    let resolvePatch!: (type: ProcessType) => void;
    server.use(
      http.patch('/api/v1/workflows/types/:id', () =>
        new Promise<ProcessType>((resolve) => {
          resolvePatch = resolve;
        }).then((type) => HttpResponse.json(type)),
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const type = makeType('1');
    client.setQueryData(automationKeys.types(), [type]);

    const { result } = hook(client);
    result.current.mutate({ id: type.id, body: { creatable: true } });

    // До resolve — в кэше уже новое значение (I4), мутация ещё в полёте.
    await waitFor(() => {
      expect(client.getQueryData<ProcessType[]>(automationKeys.types())?.[0]?.creatable).toBe(true);
    });
    expect(result.current.isPending).toBe(true);

    resolvePatch({ ...type, creatable: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    server.close();
  });

  it('ошибка сервера откатывает снапшот', async () => {
    server.use(
      http.patch('/api/v1/workflows/types/:id', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const type = makeType('2');
    client.setQueryData(automationKeys.types(), [type]);

    const { result } = hook(client);
    result.current.mutate({ id: type.id, body: { creatable: true } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Снапшот возвращён: в кэше прежнее значение.
    expect(client.getQueryData<ProcessType[]>(automationKeys.types())?.[0]?.creatable).toBe(false);
    server.close();
  });
});

describe('useStageNames: подсказки имён статусов (#430)', () => {
  it('запрашивает каталог с категорией и исключением текущего маршрута', async () => {
    server.use(
      http.get('/api/v1/workflows/stage-names', () =>
        HttpResponse.json([{ systemState: 'active', name: 'В работе', routes: 2 }]),
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useStageNames('task', 'wf-1'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ systemState: 'active', name: 'В работе', routes: 2 }]);
    expect(workflowKeys.stageNames('task', 'wf-1')).toEqual([
      'workflows',
      'stage-names',
      'task',
      'wf-1',
    ]);
    server.close();
  });
});
