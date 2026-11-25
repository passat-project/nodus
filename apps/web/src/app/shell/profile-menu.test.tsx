// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui, type AuthUser, type UserListItem } from '@nodus/contracts';

import { usersListKey } from '../../shared/api/users-list.js';
import { useAuthStore } from '../../shared/auth-store.js';
import { stubLoadedImage } from '../../test/stub-loaded-image.js';
import { LATEST_RELEASE } from '../../features/whats-new/model/releases.js';
import { useWhatsNewStore } from '../../features/whats-new/model/whats-new-store.js';
import { ProfileMenu } from './profile-menu.js';

/**
 * Меню профиля в топбаре: три аспекта одной поверхности —
 * - аватар своего профиля (#726): источник — тот же кэш справочника, что у
 *   остальных поверхностей (`usersListKey`), фото появляется сразу после смены
 *   аватара (инвалидация `invalidateAvatarCaches`), без F5;
 * - пункт «Профиль» (#751): открывает СВОЮ карточку сотрудника тем же стеком,
 *   что из проекта/справочника;
 * - пункт «Что нового» (#1038): вход в историю обновлений после переезда из
 *   строки топбара; точка — последний выпуск не просмотрен.
 * `useOpenCard` требует роутер-контекст — в тестах подменяется моком.
 */

const mocks = vi.hoisted(() => ({ openCard: vi.fn() }));
vi.mock('./use-card-stack.js', () => ({ useOpenCard: () => mocks.openCard }));

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

function renderMenu(seed?: UserListItem[], user: AuthUser = ME) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) client.setQueryData(usersListKey, { items: seed, nextCursor: null });
  useAuthStore.setState({ status: 'authenticated', accessToken: 'test-token', user });
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
  mocks.openCard.mockClear();
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null });
  useWhatsNewStore.setState({ seen: {}, open: false, openReason: 'manual' });
});

/** Открыть меню (Radix): фокус на триггер + Enter, дождаться портала. */
async function openMenu() {
  const trigger = screen.getByRole('button', { name: ui.topbar.profile });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('menu')).not.toBeNull());
}

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

describe('ProfileMenu — «Профиль» в меню аватара (#751)', () => {
  it('пункт «Профиль» первый, клик открывает свою карточку сотрудника', async () => {
    renderMenu();
    await openMenu();

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      ui.topbar.profile,
      ui.whatsNew.title,
      ui.topbar.logout,
    ]);

    fireEvent.click(screen.getByRole('menuitem', { name: ui.topbar.profile }));
    expect(mocks.openCard).toHaveBeenCalledWith({ kind: 'employee', id: ME_ID });
  });

  it('право project.setup.manage не возвращает «Настройки портала» — меню профильное (#738)', async () => {
    // Именно это право рисовало пункт до #738: регресс-тест на ветку, которая
    // удалена, а не только на «обычного» пользователя без прав.
    renderMenu(undefined, {
      ...ME,
      permissions: ['project.setup.manage'] as AuthUser['permissions'],
    });
    await openMenu();

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      ui.topbar.profile,
      ui.whatsNew.title,
      ui.topbar.logout,
    ]);
    expect(screen.queryByRole('menuitem', { name: 'Настройки портала' })).toBeNull();
  });
});

describe('ProfileMenu — «Что нового» в меню аватара (#1038)', () => {
  it('между «Профиль» и «Выйти»: клик открывает панель и отмечает выпуск просмотренным', async () => {
    useWhatsNewStore.setState({ seen: {} });
    renderMenu();
    await openMenu();

    const whatsNew = screen.getByRole('menuitem', { name: ui.whatsNew.title });
    // Пункт текстовый, без иконки-искорки (спарклы — только ИИ-ассистенту).
    expect(whatsNew.querySelector('svg')).toBeNull();
    fireEvent.click(whatsNew);

    const state = useWhatsNewStore.getState();
    expect(state.open).toBe(true);
    expect(state.openReason).toBe('manual');
    expect(state.seen[ME_ID]).toBe(LATEST_RELEASE?.version);
  });

  it('точка — свежий выпуск не просмотрен; просмотренный выпуск гасит её', async () => {
    useWhatsNewStore.setState({ seen: {} });
    const { unmount } = renderMenu();
    await openMenu();
    expect(screen.getByTestId('whats-new-unseen')).not.toBeNull();
    unmount();

    useWhatsNewStore.setState({ seen: { [ME_ID]: LATEST_RELEASE!.version } });
    renderMenu();
    await openMenu();
    expect(screen.queryByTestId('whats-new-unseen')).toBeNull();
  });
});
