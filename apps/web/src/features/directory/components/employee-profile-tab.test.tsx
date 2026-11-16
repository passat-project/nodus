// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui, type UserCard, type UserListItem } from '@nodus/contracts';

import { demoUserCards, demoUserListItems } from '../../../shared/mocks/data/users.js';
import { EmployeeProfileTab } from './employee-profile-tab.js';

/**
 * Возврат деактивированного сотрудника в работу (AUD-016): кнопка видна
 * только уволенному и только при праве управления справочником, содержит
 * подсказку о составе бесед/проектов и вызывает мутацию активации.
 */

const activate = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock('../api/directory-api.js', () => ({
  useSetMyAvatar: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveMyAvatar: () => ({ mutate: vi.fn() }),
  useActivateUser: () => activate,
}));

vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));

vi.mock('../../../shared/ui/entity-fields.js', () => ({
  EntityFields: () => <div>поля профиля</div>,
}));

vi.mock('./employee-edit-dialog.js', () => ({
  EmployeeEditDialog: () => <div>окно правки</div>,
}));

const deactivated = demoUserCards.find((card) => card.status === 'deactivated') as UserCard;
const active = demoUserCards.find((card) => card.status === 'active') as UserCard;
const listItemOf = (card: UserCard): UserListItem =>
  demoUserListItems.find((item) => item.id === card.id) as UserListItem;

function renderTab(card: UserCard, canManage: boolean) {
  return render(
    <EmployeeProfileTab
      card={card}
      listItem={listItemOf(card)}
      manager={undefined}
      subordinates={[]}
      presenceStatus="offline"
      users={demoUserListItems}
      canManage={canManage}
    />,
  );
}

beforeEach(() => {
  activate.mutate.mockClear();
  activate.isPending = false;
});

afterEach(cleanup);

describe('EmployeeProfileTab: «Вернуть в работу» (AUD-016)', () => {
  it('у деактивированного сотрудника кнопка видна, несёт подсказку и вызывает активацию', () => {
    renderTab(deactivated, true);
    const button = screen.getByRole('button', { name: ui.employees.activateEmployee });
    expect(button.getAttribute('title')).toBe(ui.employees.activateHint);
    fireEvent.click(button);
    expect(activate.mutate).toHaveBeenCalledTimes(1);
  });

  it('у активного сотрудника кнопки нет', () => {
    renderTab(active, true);
    expect(screen.queryByRole('button', { name: ui.employees.activateEmployee })).toBeNull();
  });

  it('без права управления справочником кнопки нет', () => {
    renderTab(deactivated, false);
    expect(screen.queryByRole('button', { name: ui.employees.activateEmployee })).toBeNull();
  });
});
