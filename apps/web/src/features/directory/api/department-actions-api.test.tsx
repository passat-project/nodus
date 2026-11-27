// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DepartmentNode, Paginated, UserListItem } from '@nodus/contracts';

import { usersListKey } from '../../../shared/api/users-list.js';
import { useDeleteDepartment, useTransferEmployee } from './department-actions-api.js';
import { directoryKeys } from './directory-keys.js';

/** #881: оптимистичные мутации действий с подразделением (I4). */

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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const node = (
  id: string,
  parentId: string | null,
  children: DepartmentNode[] = [],
): DepartmentNode => ({
  id,
  name: id,
  kind: 'management',
  parentId,
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 0,
  children,
});

const person = (id: string, departmentId: string | null): UserListItem => ({
  id,
  displayName: id,
  status: 'active',
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDeleteDepartment (#881)', () => {
  it('убирает ветку из кэша дерева до ответа; ошибка возвращает снапшот', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = directoryKeys.departments('management');
    client.setQueryData(key, [node('root', null, [node('child', 'root')])]);
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useDeleteDepartment('management'), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate('child');
    });
    const optimistic = client.getQueryData<DepartmentNode[]>(key);
    expect(optimistic?.[0]?.children).toEqual([]);

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify({ code: 'CONFLICT', message: 'bad', traceId: 't' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<DepartmentNode[]>(key)).toEqual([
      node('root', null, [node('child', 'root')]),
    ]);
  });
});

describe('useTransferEmployee (#881)', () => {
  it('оптимистично меняет departmentId в справочнике; ошибка откатывает', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const previous: Paginated<UserListItem> = {
      items: [person('u1', 'old'), person('u2', 'old')],
      nextCursor: null,
    };
    client.setQueryData(usersListKey, previous);
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useTransferEmployee(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ userId: 'u1', departmentId: 'new' });
    });
    expect(client.getQueryData<Paginated<UserListItem>>(usersListKey)?.items[0]?.departmentId).toBe(
      'new',
    );

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify({ code: 'CONFLICT', message: 'bad', traceId: 't' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(usersListKey)).toEqual(previous);
  });
});
