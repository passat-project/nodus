// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeletePosition, useReassignPosition } from './directory-api.js';

/** Мутации должностей (#768): DELETE и POST /reassign бьют в живые пути. */
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('мутации должностей (#768)', () => {
  it('удаление — DELETE /directory/positions/:id', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeletePosition('management'), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync('p-1');
    });

    const [input, init] = fetchMock.mock.calls[0]! as unknown as [RequestInfo | URL, RequestInit];
    expect(String(input)).toContain('/directory/positions/p-1');
    expect(init.method).toBe('DELETE');
  });

  it('переназначение — POST /directory/positions/:id/reassign с targetId', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useReassignPosition('management'), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'p-1', targetId: 'p-2' });
    });

    const [input, init] = fetchMock.mock.calls[0]! as unknown as [RequestInfo | URL, RequestInit];
    expect(String(input)).toContain('/directory/positions/p-1/reassign');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ targetId: 'p-2' });
  });
});
