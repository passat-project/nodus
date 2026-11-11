// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../shared/auth-store.js';
import { ProfileMenu } from './profile-menu.js';

/** Меню аватара: «Профиль» первым пунктом действий открывает СВОЮ карточку
 *  сотрудника тем же стеком, что из проекта/справочника (#751). */

const mocks = vi.hoisted(() => ({ openCard: vi.fn() }));
vi.mock('./use-card-stack.js', () => ({ useOpenCard: () => mocks.openCard }));

const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'me@nodus.by',
  displayName: 'Артём Маторин',
  permissions: [] as string[],
};

beforeEach(() => {
  useAuthStore.setState({ user: ME });
});

afterEach(() => {
  cleanup();
  mocks.openCard.mockClear();
  useAuthStore.setState({ user: null });
});

async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Профиль' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('menu')).not.toBeNull());
}

describe('ProfileMenu — «Профиль» в меню аватара (#751)', () => {
  it('пункт «Профиль» первый, клик открывает свою карточку сотрудника', async () => {
    render(<ProfileMenu />);
    await openMenu();

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([ui.topbar.profile, ui.topbar.logout]);

    fireEvent.click(screen.getByRole('menuitem', { name: ui.topbar.profile }));
    expect(mocks.openCard).toHaveBeenCalledWith({ kind: 'employee', id: ME.id });
  });
});
