// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserCard } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { directoryKeys, useDeactivateUser, useUpdateMyProfile } from './directory-api.js';

/**
 * Саморедактирование и увольнение (#923, I4): кэш меняется ДО ответа сервера,
 * ошибка откатывает снимок; смена своего имени обновляет auth-store (топбар).
 */

const ME = '11111111-1111-4111-8111-111111111111';

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

const card = (overrides: Partial<UserCard> = {}): UserCard => ({
  id: ME,
  email: 'me@test.local',
  displayName: 'Иванов Иван',
  status: 'active',
  lastName: 'Иванов',
  firstName: 'Иван',
  middleName: null,
  managerId: null,
  departmentId: 'dep-1',
  positionId: null,
  legalDepartmentId: null,
  legalPositionId: null,
  mobilePhone: null,
  city: null,
  officeLocation: null,
  isRemote: false,
  workRate: null,
  gender: null,
  birthDate: null,
  hiredAt: null,
  workdayStart: null,
  avatarUrl: null,
  roles: [],
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

function stubMutation(gate: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' || init?.method === 'POST'
        ? gate
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: ME, email: 'me@test.local', displayName: 'Иванов Иван', permissions: [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateMyProfile (#923)', () => {
  it('патч своей карточки ДО ответа, displayName и auth-store после', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(directoryKeys.userCard(ME), card());
    const gate = deferred<Response>();
    stubMutation(gate.promise);
    const { result } = renderHook(() => useUpdateMyProfile(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ firstName: 'Пётр' });
    });

    const optimistic = client.getQueryData(directoryKeys.userCard(ME)) as UserCard;
    expect(optimistic.firstName).toBe('Пётр');
    expect(optimistic.displayName).toBe('Иванов Пётр');

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(card({ firstName: 'Пётр', displayName: 'Иванов Пётр' })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useAuthStore.getState().user?.displayName).toBe('Иванов Пётр');
  });

  it('ошибка сервера — откат карточки и имени в топбаре', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(directoryKeys.userCard(ME), card());
    const gate = deferred<Response>();
    stubMutation(gate.promise);
    const { result } = renderHook(() => useUpdateMyProfile(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ firstName: 'Пётр' });
    });
    expect((client.getQueryData(directoryKeys.userCard(ME)) as UserCard).firstName).toBe('Пётр');

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify({ code: 'VALIDATION_FAILED', message: 'bad', traceId: 't' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((client.getQueryData(directoryKeys.userCard(ME)) as UserCard).firstName).toBe('Иван');
    expect(useAuthStore.getState().user?.displayName).toBe('Иванов Иван');
  });
});

describe('useDeactivateUser (#923)', () => {
  it('статус меняется оптимистично и откатывается при ошибке', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(directoryKeys.userCard('user-2'), card({ id: 'user-2' }));
    const gate = deferred<Response>();
    stubMutation(gate.promise);
    const { result } = renderHook(() => useDeactivateUser('user-2'), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    expect((client.getQueryData(directoryKeys.userCard('user-2')) as UserCard).status).toBe(
      'deactivated',
    );

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify({ code: 'CONFLICT', message: 'no', traceId: 't' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((client.getQueryData(directoryKeys.userCard('user-2')) as UserCard).status).toBe(
      'active',
    );
  });
});
