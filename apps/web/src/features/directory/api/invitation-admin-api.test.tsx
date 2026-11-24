// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvitationCreated, UserListItem } from '@nodus/contracts';

import { directoryKeys } from './directory-keys.js';
import {
  useCancelInvitation,
  useCreateInvitation,
  useIssuePasswordReset,
  useReissueInvitation,
} from './invitation-admin-api.js';

const USER_ID = '21111111-1111-4111-8111-111111111111';
const CREATED: InvitationCreated = {
  id: USER_ID,
  token: 't'.repeat(64),
  path: `/invite/${'t'.repeat(64)}`,
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('админские хуки приглашений (#101)', () => {
  it('создание/перевыпуск/reset возвращают одноразовую ссылку', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/password-reset')) {
        return json({ ...CREATED, path: `/reset/${'t'.repeat(64)}` });
      }
      if (url.endsWith('/reissue')) return json(CREATED);
      return json(CREATED, 201);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const create = renderHook(() => useCreateInvitation(), { wrapper: wrapper(client) });
    let created: InvitationCreated | undefined;
    await act(async () => {
      created = await create.result.current.mutateAsync({
        email: 'new@nodus.by',
        lastName: 'Новиков',
        firstName: 'Иван',
        middleName: null,
        positionId: 'p1',
        departmentId: 'd1',
        workRate: null,
        hiredAt: null,
      });
    });
    expect(created?.token).toHaveLength(64);

    const reissue = renderHook(() => useReissueInvitation(USER_ID), { wrapper: wrapper(client) });
    await act(async () => {
      await reissue.result.current.mutateAsync();
    });
    expect(reissue.result.current.isSuccess).toBe(true);

    const reset = renderHook(() => useIssuePasswordReset(USER_ID), { wrapper: wrapper(client) });
    await act(async () => {
      const result = await reset.result.current.mutateAsync();
      expect(result.path.startsWith('/reset/')).toBe(true);
    });
  });

  it('отмена убирает строку из списка сразу (I4), сервер — 204', async () => {
    let release!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'DELETE' ? gate : json({}),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const item = { id: USER_ID, displayName: 'Новиков Иван' } as UserListItem;
    client.setQueryData(directoryKeys.users(), { items: [item], nextCursor: null });

    const { result } = renderHook(() => useCancelInvitation(USER_ID), {
      wrapper: wrapper(client),
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.mutateAsync();
    });
    // Оптимистично: строка исчезла до ответа сервера.
    await waitFor(() =>
      expect(
        (client.getQueryData(directoryKeys.users()) as { items: UserListItem[] }).items,
      ).toHaveLength(0),
    );
    await act(async () => {
      release(new Response(null, { status: 204 }));
      await pending;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
