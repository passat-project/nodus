// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser, UserListItem } from '@nodus/contracts';

import { usersListKey } from '../../shared/api/users-list.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { stubLoadedImage } from '../../test/stub-loaded-image.js';
import { ProfileMenu } from './profile-menu.js';

/**
 * Аватар своего профиля в топбаре (#726): источник — тот же кэш справочника,
 * что у остальных поверхностей (`usersListKey`), поэтому фото появляется сразу
 * после смены аватара (инвалидация `invalidateAvatarCaches`), без F5.
 */

const ME_ID = '00000000-0000-4000-8000-0000000000b2';
const PHOTO = 'https://files.nodus.local/avatar/me.png';

const ME: AuthUser = {
  id: ME_ID,
  email: 'anna@nodus.local',
  displayName: 'Анна Первая',
  permissions: [],
};

const person = (overrides: Partial<UserListItem> = {}): UserListItem => ({
  id: ME_ID,
  displayName: 'Анна Первая',
  status: 'active',
  avatarUrl: PHOTO,
  positionName: null,
  departmentName: null,
  email: 'anna@nodus.local',
  managerId: null,
  departmentId: null,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
  ...overrides,
});

function renderMenu(seed?: UserListItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) client.setQueryData(usersListKey, { items: seed, nextCursor: null });
  useAuthStore.setState({ status: 'authenticated', accessToken: 'test-token', user: ME });
  const utils = render(
    <QueryClientProvider client={client}>
      <ProfileMenu />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

/** jsdom не загружает картинки (см. `stub-loaded-image`). */

let restoreImage: (() => void) | null = null;
afterEach(() => {
  restoreImage?.();
  restoreImage = null;
  cleanup();
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null });
});

describe('ProfileMenu — аватар профиля в топбаре (#726)', () => {
  it('фото из справочника: img с url, декоративный (имя несёт aria-label кнопки)', () => {
    restoreImage = stubLoadedImage();
    const { container } = renderMenu([person()]);
    const img = container.querySelector('[data-slot="avatar"] img');
    expect(img?.getAttribute('src')).toBe(PHOTO);
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('фото нет: те же инициалы, что и раньше', () => {
    const { container } = renderMenu([person({ avatarUrl: null })]);
    expect(container.querySelector('[data-slot="avatar"] img')).toBeNull();
    expect(container.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('АП');
  });

  it('справочник ещё не пришёл: инициалы, топбар не падает', () => {
    const { container } = renderMenu();
    expect(container.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('АП');
  });

  it('свежие данные справочника (после инвалидации) подхватываются без перемонтирования', async () => {
    restoreImage = stubLoadedImage();
    const { container, client } = renderMenu();
    expect(container.querySelector('[data-slot="avatar"] img')).toBeNull();

    act(() => {
      client.setQueryData(usersListKey, { items: [person()], nextCursor: null });
    });

    await waitFor(() =>
      expect(container.querySelector('[data-slot="avatar"] img')?.getAttribute('src')).toBe(PHOTO),
    );
  });
});
