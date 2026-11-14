// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DepartmentNode } from '@nodus/contracts';

import { directoryKeys, useUpdateDepartment } from './directory-api.js';

/**
 * Оптимистичность правки подразделения (#817, I4): набор заместителей
 * применяется к кэшу дерева ДО ответа сервера (id и чипы видны сразу), ошибка
 * сервера — откат к прежнему узлу. Без миллисекундных ожиданий.
 */

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';
const DEPUTY_A = '22222222-2222-4222-8222-222222222222';
const DEPUTY_B = '33333333-3333-4333-8333-333333333333';

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
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const node: DepartmentNode = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: null,
  deputyIds: [DEPUTY_A],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [{ id: DEPUTY_A, displayName: 'Зам Один' }],
  memberCount: 0,
  children: [],
};

function stubPatch(gate: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'PATCH'
        ? gate
        : new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );
}

const deputiesOf = (client: QueryClient) =>
  (client.getQueryData(directoryKeys.departments('management')) as DepartmentNode[])[0]!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateDepartment — оптимистичный набор заместителей (#817)', () => {
  it('второй заместитель виден в кэше ДО ответа сервера', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(directoryKeys.departments('management'), [node]);
    const gate = deferred<Response>();
    stubPatch(gate.promise);
    const { result } = renderHook(() => useUpdateDepartment('management'), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ id: DEPARTMENT_ID, patch: { deputyIds: [DEPUTY_A, DEPUTY_B] } });
    });

    // Оптимистично: набор и порядок уже в кэше, имя нового подтянет инвалидация.
    expect(deputiesOf(client).deputyIds).toEqual([DEPUTY_A, DEPUTY_B]);
    expect(deputiesOf(client).deputies.map((deputy) => deputy.id)).toEqual([DEPUTY_A, DEPUTY_B]);

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify({ ...node, deputyIds: [DEPUTY_A, DEPUTY_B] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('ошибка сервера — откат набора к исходному узлу', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(directoryKeys.departments('management'), [node]);
    const gate = deferred<Response>();
    stubPatch(gate.promise);
    const { result } = renderHook(() => useUpdateDepartment('management'), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ id: DEPARTMENT_ID, patch: { deputyIds: [] } });
    });
    expect(deputiesOf(client).deputyIds).toEqual([]);

    await act(async () => {
      gate.resolve(
        new Response(
          JSON.stringify({
            code: 'DIRECTORY_REFERENCE_INVALID',
            message: 'bad',
            traceId: 't',
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(deputiesOf(client).deputyIds).toEqual([DEPUTY_A]);
  });
});
