// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useAcceptInvitation,
  useAcceptPasswordReset,
  useInvitationInfo,
  usePasswordResetInfo,
} from './invitation-public-api.js';

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

/** Публичные запросы идут без Bearer и без refresh-retry (auth:false). */
describe('публичные хуки приглашений (#101)', () => {
  it('info приглашения и сброса читаются по токену', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/password-resets/')) {
        return json({
          kind: 'reset',
          displayName: 'Новиков Иван',
          email: 'new@nodus.by',
          expiresAt: new Date().toISOString(),
        });
      }
      return json({
        kind: 'invite',
        displayName: 'Новиков Иван',
        email: 'new@nodus.by',
        departmentName: 'Проектный отдел',
        positionName: 'Инженер',
        expiresAt: new Date().toISOString(),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const invite = renderHook(() => useInvitationInfo('token-1'), { wrapper: wrapper(client) });
    await waitFor(() => expect(invite.result.current.isSuccess).toBe(true));
    expect(invite.result.current.data?.kind).toBe('invite');

    const reset = renderHook(() => usePasswordResetInfo('token-2'), { wrapper: wrapper(client) });
    await waitFor(() => expect(reset.result.current.isSuccess).toBe(true));
    expect(reset.result.current.data?.kind).toBe('reset');
    // Bearer не отправляется: страницу открывает аноним.
    const headers = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).headers);
    expect(JSON.stringify(headers)).not.toContain('authorization');
  });

  it('accept и accept-reset отправляют почту и пароль', async () => {
    const fetchMock = vi.fn(async () =>
      json({ id: '31111111-1111-4111-8111-111111111111', email: 'new@nodus.by' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const accept = renderHook(() => useAcceptInvitation('token-1'), { wrapper: wrapper(client) });
    await accept.result.current.mutateAsync({ email: 'new@nodus.by', password: 'Strong!Pass123' });

    const reset = renderHook(() => useAcceptPasswordReset('token-2'), {
      wrapper: wrapper(client),
    });
    await reset.result.current.mutateAsync({
      email: 'new@nodus.by',
      password: 'Strong!Pass124',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/invitations/token-1/accept');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/password-resets/token-2/accept');
  });
});
