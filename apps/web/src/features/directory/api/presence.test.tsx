// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEmployeePresence, usePresence } from './presence.js';

/** Presence (#104, #923): REST — только мок-режим, живой контур — WS-сокеты. */

const state = vi.hoisted(() => ({ mocked: false, online: false }));

vi.mock('../../../shared/api/api-mock-config.js', () => ({
  isDomainMocked: () => state.mocked,
}));

vi.mock('../../../shared/api-client.js', () => ({
  api: vi.fn(async () => [{ user: { id: 'u1', displayName: 'A' }, status: 'away' }]),
}));

vi.mock('../../../shared/socket/presence-store.js', () => ({
  useIsOnline: () => state.online,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  state.mocked = false;
  state.online = false;
});

describe('presence (#923)', () => {
  it('живой контур: статус из WS, REST не запрашивается', () => {
    state.online = true;
    const { result } = renderHook(() => useEmployeePresence('u1'), { wrapper });
    expect(result.current).toBe('online');
    expect(renderHook(() => usePresence(), { wrapper }).result.current.fetchStatus).toBe('idle');
  });

  it('мок-контур: статус из REST-моков', async () => {
    state.mocked = true;
    const { result } = renderHook(() => useEmployeePresence('u1'), { wrapper });
    await waitFor(() => expect(result.current).toBe('away'));
  });

  it('мок-контур: отсутствующий сотрудник — offline', async () => {
    state.mocked = true;
    const { result } = renderHook(() => useEmployeePresence('u2'), { wrapper });
    await waitFor(() => expect(result.current).toBe('offline'));
  });
});
