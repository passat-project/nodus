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

import { chatKeys } from '../../../shared/chat/chat-keys.js';
import { useRemoveMyAvatar, useSetMyAvatar } from './directory-api.js';

/**
 * #726: смена/удаление ЛИЧНОГО фото обязана сбрасывать кэш чата — в DTO
 * сообщения лежит копия `author.avatarUrl`, иначе старые пузыри живут со старым
 * фото до F5. Тест падает, если вызов `invalidateChatAvatarCaches` убрать из
 * мутаций (`directory-api.ts`).
 */

const card = (overrides: Partial<UserCard> = {}): UserCard => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@test.local',
  displayName: 'Сотрудник Тест',
  status: 'active',
  lastName: 'Тест',
  firstName: 'Сотрудник',
  middleName: null,
  managerId: null,
  departmentId: null,
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
  avatarUrl: 'https://files.nodus.local/avatar/me.png',
  roles: [],
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

/** Загрузка — XHR (apiUpload), для теста кэша подменяем сам uploadAvatar. */
vi.mock('../../../shared/chat/avatar-upload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/chat/avatar-upload.js')>();
  return { ...actual, uploadAvatar: vi.fn(async () => card()) };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

const avatarCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map(([filters]) => (filters as { queryKey?: readonly unknown[] } | undefined)?.queryKey)
    .filter((key) => key !== undefined);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Мутации своего аватара сбрасывают кэш чата (#726)', () => {
  it('useSetMyAvatar: после успеха инвалидирован весь кэш чата', async () => {
    const client = makeClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetMyAvatar(), { wrapper: wrapperFor(client) });

    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' });
    await act(async () => {
      result.current.mutate(file);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(avatarCalls(spy)).toContainEqual(chatKeys.all);
  });

  it('useRemoveMyAvatar: после успеха инвалидирован весь кэш чата', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(card({ avatarUrl: null })), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const client = makeClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRemoveMyAvatar(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(avatarCalls(spy)).toContainEqual(chatKeys.all);
  });
});
