// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserCard } from '@nodus/contracts';

import { directoryKeys, useUpdateUser } from './directory-api.js';

/**
 * Оптимистичность правки сотрудника (#441, I4/patterns.md): патч карточки
 * применяется ДО ответа сервера (контролируемый deferred), ошибка — откат по
 * снапшоту. Без миллисекундных ожиданий.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';

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
  id: USER_ID,
  email: 'user@test.local',
  displayName: 'Сотрудник Тест',
  status: 'active',
  lastName: 'Тест',
  firstName: 'Сотрудник',
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

function stubPatch(gate: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'PATCH'
        ? gate
        : new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateUser — оптимистичность (#441)', () => {
  it('патч карточки в кэше ДО ответа сервера, onSuccess — серверная версия', async () => {
    const client = new QueryClient();
    client.setQueryData(directoryKeys.userCard(USER_ID), card());
    const gate = deferred<Response>();
    stubPatch(gate.promise);
    const { result } = renderHook(() => useUpdateUser(USER_ID), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ departmentId: 'dep-2' });
    });

    // Оптимистично: до resolve.
    expect((client.getQueryData(directoryKeys.userCard(USER_ID)) as UserCard).departmentId).toBe(
      'dep-2',
    );

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(card({ departmentId: 'dep-2' })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((client.getQueryData(directoryKeys.userCard(USER_ID)) as UserCard).departmentId).toBe(
      'dep-2',
    );
  });

  it('ошибка сервера — откат кэша к исходной карточке', async () => {
    const client = new QueryClient();
    client.setQueryData(directoryKeys.userCard(USER_ID), card());
    const gate = deferred<Response>();
    stubPatch(gate.promise);
    const { result } = renderHook(() => useUpdateUser(USER_ID), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ managerId: 'user-2' });
    });
    expect((client.getQueryData(directoryKeys.userCard(USER_ID)) as UserCard).managerId).toBe(
      'user-2',
    );

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
    expect((client.getQueryData(directoryKeys.userCard(USER_ID)) as UserCard).managerId).toBeNull();
  });
});
