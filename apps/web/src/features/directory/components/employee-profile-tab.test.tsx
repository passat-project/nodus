// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui, type UserCard, type UserListItem } from '@nodus/contracts';

import { demoUserCards, demoUserListItems } from '../../../shared/mocks/data/users.js';
import { EmployeeProfileTab } from './employee-profile-tab.js';

/**
 * Левая зона профиля (#923): заголовки «Информация о сотруднике» и
 * «Подчинённые» тем же стилем, подчинённые — сетка с переходом в карточку,
 * камера аватара только на своей карточке. Кнопки правки/действий живут в
 * нижней полосе карточки — их покрывает `employee-actions-menu.test.tsx`.
 */

const openCard = vi.hoisted(() => vi.fn());

vi.mock('../api/directory-api.js', () => ({
  useSetMyAvatar: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveMyAvatar: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => openCard }));

vi.mock('../../../shared/ui/entity-fields.js', () => ({
  EntityFields: () => <div>поля профиля</div>,
}));

const card = demoUserCards.find((entry) => entry.status === 'active') as UserCard;
const listItemOf = (id: string): UserListItem =>
  demoUserListItems.find((item) => item.id === id) as UserListItem;
const subordinates: UserListItem[] = [
  {
    ...listItemOf(card.id),
    id: 'sub-1',
    displayName: 'Первый Подчинённый',
    positionName: 'Инженер',
  },
  { ...listItemOf(card.id), id: 'sub-2', displayName: 'Второй Подчинённый', positionName: null },
];

function renderTab(options: { canEditAvatar?: boolean; subordinates?: UserListItem[] } = {}) {
  return render(
    <EmployeeProfileTab
      card={card}
      listItem={listItemOf(card.id)}
      manager={undefined}
      subordinates={options.subordinates ?? []}
      presenceStatus="offline"
      canEditAvatar={options.canEditAvatar ?? false}
    />,
  );
}

afterEach(cleanup);

describe('EmployeeProfileTab: секции и подчинённые (#923)', () => {
  it('заголовок «Информация о сотруднике» над полями и «Подчинённые» со счётчиком', () => {
    renderTab({ subordinates });
    expect(screen.getByRole('heading', { name: ui.employees.profileInfo })).not.toBeNull();
    expect(screen.getByText('поля профиля')).not.toBeNull();
    const heading = screen.getByRole('heading', { name: new RegExp(ui.employees.subordinates) });
    expect(heading.textContent).toContain('2');
  });

  it('подчинённый открывается в стек карточек, должность не теряется', () => {
    renderTab({ subordinates });
    fireEvent.click(screen.getByText('Первый Подчинённый'));
    expect(openCard).toHaveBeenCalledWith({ kind: 'employee', id: 'sub-1' });
    expect(screen.getByText('Инженер')).not.toBeNull();
  });

  it('пусто — одна строка «пусто», без сетки-мусора', () => {
    renderTab();
    expect(screen.getByText(ui.common.empty)).not.toBeNull();
  });

  it('камера аватара — только на своей карточке', () => {
    const { rerender } = renderTab({ canEditAvatar: false });
    expect(screen.queryByRole('button', { name: ui.common.avatarChange })).toBeNull();
    rerender(
      <EmployeeProfileTab
        card={{ ...card, avatarUrl: null }}
        listItem={listItemOf(card.id)}
        manager={undefined}
        subordinates={[]}
        presenceStatus="offline"
        canEditAvatar
      />,
    );
    expect(screen.getByRole('button', { name: ui.common.avatarUpload })).not.toBeNull();
  });
});
