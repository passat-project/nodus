// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserListItem } from '@nodus/contracts';

import { usersListKey } from '../api/users-list.js';
import { stubLoadedImage } from '../../test/stub-loaded-image.js';
import { PersonAvatar, PersonAvatarById } from './person-avatar.js';

/**
 * Единый механизм аватара (#726): фото — если оно есть, иначе те же
 * графитовые инициалы; `PersonAvatarById` берёт фото из одного кэша
 * справочника (`usersListKey`) и НЕ создаёт собственный запрос.
 */

const USER_ID = '00000000-0000-4000-8000-0000000000a1';
const PHOTO = 'https://files.nodus.local/avatar/me.png';

const user = (overrides: Partial<UserListItem> = {}): UserListItem => ({
  id: USER_ID,
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

function renderInQuery(node: React.ReactElement, seed?: UserListItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) client.setQueryData(usersListKey, { items: seed, nextCursor: null });
  const utils = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ...utils, client };
}

const avatarImg = (root: Element) => root.querySelector('[data-slot="avatar"] img');
const fallbackText = (root: Element) =>
  root.querySelector('[data-slot="avatar-fallback"]')?.textContent ?? null;

let restoreImage: (() => void) | null = null;
afterEach(() => {
  restoreImage?.();
  restoreImage = null;
  cleanup();
});

describe('PersonAvatar — фото или инициалы (#726)', () => {
  it('фото есть: img с url автора и его именем в alt', () => {
    restoreImage = stubLoadedImage();
    const { container } = render(
      <PersonAvatar name="Иван Петров" avatarUrl={PHOTO} className="size-7" />,
    );
    const img = avatarImg(container);
    expect(img?.getAttribute('src')).toBe(PHOTO);
    expect(img?.getAttribute('alt')).toBe('Иван Петров');
    // размер и скругление не зависят от наличия фото (геометрия пузырей)
    const root = container.querySelector('[data-slot="avatar"]')!;
    expect(root.className).toContain('size-7');
    expect(root.className).toContain('rounded-full');
  });

  it('фото нет: инициалы, img не рисуется', () => {
    const { container } = render(<PersonAvatar name="Иван Петров" avatarUrl={null} />);
    expect(avatarImg(container)).toBeNull();
    expect(fallbackText(container)).toBe('ИП');
  });

  it('декоративный: фото и инициалы скрыты от скринридера (alt="", aria-hidden)', () => {
    restoreImage = stubLoadedImage();
    const { container } = render(<PersonAvatar name="Иван Петров" avatarUrl={PHOTO} decorative />);
    const img = avatarImg(container);
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-slot="avatar"]')?.getAttribute('aria-hidden')).not.toBe(
      'true',
    );
  });

  it('декоративный без фото: инициалы с aria-hidden', () => {
    const { container } = render(<PersonAvatar name="Иван Петров" avatarUrl={null} decorative />);
    expect(
      container.querySelector('[data-slot="avatar-fallback"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });
});

describe('PersonAvatarById — фото из единого кэша справочника (#726)', () => {
  it('id из кэша людей → img с тем же url (топбар, чипы создания чата)', () => {
    restoreImage = stubLoadedImage();
    const { container } = renderInQuery(
      <PersonAvatarById userId={USER_ID} name="Анна Первая" decorative />,
      [user()],
    );
    expect(avatarImg(container)?.getAttribute('src')).toBe(PHOTO);
  });

  it('нет сотрудника в кэше → инициалы (fallback как раньше)', () => {
    const { container } = renderInQuery(
      <PersonAvatarById userId={USER_ID} name="Анна Первая" decorative />,
      [user({ avatarUrl: null })],
    );
    expect(avatarImg(container)).toBeNull();
    expect(fallbackText(container)).toBe('АП');
  });

  it('лишнего запроса не делает: справочник читается только из кэша', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = renderInQuery(
      <PersonAvatarById userId={USER_ID} name="Анна Первая" decorative />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fallbackText(container)).toBe('АП');
    fetchSpy.mockRestore();
  });
});
