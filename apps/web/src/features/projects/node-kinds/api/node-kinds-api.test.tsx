// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind } from '@nodus/contracts';
import { DEFAULT_NODE_KIND_FORM } from '@nodus/contracts';

import { nodeKindsKeys } from '../../../../shared/api/node-kinds.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { useUpdateNodeKind } from './node-kinds-api.js';

const KIND = '33333333-3333-4333-8333-333333333307';
const MARKA = '35560000-0000-4000-8000-000000000001';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const kind: NodeKind = {
  id: KIND,
  name: 'Комплект',
  icon: 'fileText',
  color: 'blue',
  archivedAt: null,
  form: DEFAULT_NODE_KIND_FORM,
  capabilities: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateNodeKind: оптимистичная правка вида (I4, Р17)', () => {
  it('форма вида меняется в реестре и в кэшах структур ДО ответа', async () => {
    const client = new QueryClient();
    client.setQueryData(nodeKindsKeys.list(), [kind]);
    client.setQueryData(projectsKeys.structure('p1'), {
      nodes: [],
      kinds: [kind],
      customFieldRefs: [],
    });
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useUpdateNodeKind(), { wrapper: makeWrapper(client) });

    const form = {
      code: 'required' as const,
      fields: [{ fieldId: MARKA, state: 'required' as const }],
    };
    await act(async () => {
      result.current.mutate({ id: KIND, form });
    });

    expect(client.getQueryData<NodeKind[]>(nodeKindsKeys.list())?.[0]?.form).toEqual(form);
    expect(
      client.getQueryData<{ kinds: NodeKind[] }>(projectsKeys.structure('p1'))?.kinds[0]?.form,
    ).toEqual(form);

    await act(async () => {
      gate.resolve(jsonResponse(200, { ...kind, form }));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('ошибка — откат обоих кэшей по снапшоту', async () => {
    const client = new QueryClient();
    client.setQueryData(nodeKindsKeys.list(), [kind]);
    client.setQueryData(projectsKeys.structure('p1'), {
      nodes: [],
      kinds: [kind],
      customFieldRefs: [],
    });
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useUpdateNodeKind(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ id: KIND, name: 'Другое имя' });
    });
    expect(client.getQueryData<NodeKind[]>(nodeKindsKeys.list())?.[0]?.name).toBe('Другое имя');

    await act(async () => {
      gate.resolve(jsonResponse(422, { code: 'PROJECT_NODE_KIND_FORM_INVALID', message: 'bad' }));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<NodeKind[]>(nodeKindsKeys.list())?.[0]?.name).toBe('Комплект');
    expect(
      client.getQueryData<{ kinds: NodeKind[] }>(projectsKeys.structure('p1'))?.kinds[0]?.name,
    ).toBe('Комплект');
  });
});
