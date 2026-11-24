// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type UserCard, ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { EmployeeActionsMenu, EmployeeProfileBar } from './employee-actions-menu.js';

/**
 * Действия администратора и нижняя полоса профиля (#923): полоса — только
 * при наличии кнопок, «Действия» — у админа; уволить/вернуть/дать-снять
 * администратора идут через подтверждение; себя уволить нельзя.
 */

const ME = 'me-1';
const EMPLOYEE_ROLE = { id: 'role-user', code: 'employee', name: 'Сотрудник' };
const ADMIN_ROLE = { id: 'role-admin', code: 'admin', name: 'Администратор' };

const hooks = vi.hoisted(() => ({
  deactivate: { mutate: vi.fn(), isPending: false },
  activate: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  reset: { mutateAsync: vi.fn(), isPending: false },
  reissue: { mutateAsync: vi.fn(), isPending: false },
  cancel: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('../api/directory-api.js', () => ({
  useDeactivateUser: () => hooks.deactivate,
  useActivateUser: () => hooks.activate,
  useUpdateUser: () => hooks.update,
  useIssuePasswordReset: () => hooks.reset,
  useReissueInvitation: () => hooks.reissue,
  useCancelInvitation: () => hooks.cancel,
}));

vi.mock('../../../shared/api/roles.js', () => ({
  useRoles: () => ({ data: [{ ...ADMIN_ROLE, permissions: [] }] }),
}));

const card = (overrides: Partial<UserCard> = {}): UserCard => ({
  id: 'user-1',
  email: 'user@nodus.by',
  displayName: 'Иванов Иван',
  status: 'active',
  lastName: 'Иванов',
  firstName: 'Иван',
  middleName: null,
  managerId: 'boss-1',
  departmentId: 'dep-1',
  positionId: null,
  legalDepartmentId: null,
  legalPositionId: null,
  mobilePhone: null,
  city: null,
  officeLocation: null,
  isRemote: false,
  workRate: 1,
  gender: null,
  birthDate: null,
  hiredAt: null,
  workdayStart: null,
  avatarUrl: null,
  roles: [EMPLOYEE_ROLE],
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

function openMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: ui.employees.actions }), {
    button: 0,
    pointerType: 'mouse',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: {
      id: ME,
      email: 'me@nodus.by',
      displayName: 'Я',
      permissions: [Permission.USER_MANAGE],
    },
  });
});

afterEach(cleanup);

describe('EmployeeProfileBar (#923)', () => {
  it('без права управления на чужой карточке полосы нет', () => {
    const { container } = render(
      <EmployeeProfileBar card={card()} canManage={false} onEdit={vi.fn()} />,
    );
    expect(container.querySelector('.border-t')).toBeNull();
  });

  it('своя карточка — главная кнопка «Редактировать профиль», без «Действий»', () => {
    render(<EmployeeProfileBar card={card({ id: ME })} canManage={false} onEdit={vi.fn()} />);
    expect(screen.getByRole('button', { name: ui.employees.editProfile })).not.toBeNull();
    expect(screen.queryByRole('button', { name: ui.employees.actions })).toBeNull();
  });

  it('админ видит обе кнопки, клик по главной открывает окно', () => {
    const onEdit = vi.fn();
    render(<EmployeeProfileBar card={card()} canManage onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: ui.employees.editProfile }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: ui.employees.actions })).not.toBeNull();
    // «Действия» — постоянная иконка три точки: подпись не рендерится ни на
    // какой ширине (вердикт приёмки 18.11.2026).
    expect(screen.queryByText(ui.employees.actions)).toBeNull();
  });

  it('у приглашённого админ тоже видит «⋯»: управление приглашением — там', () => {
    render(<EmployeeProfileBar card={card({ status: 'invited' })} canManage onEdit={vi.fn()} />);
    expect(screen.getByRole('button', { name: ui.employees.actions })).not.toBeNull();
  });
});

describe('EmployeeActionsMenu (#923)', () => {
  it('увольнение — через подтверждение, затем мутация', () => {
    render(<EmployeeActionsMenu card={card()} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.deactivateEmployee }));
    expect(screen.getByText(ui.employees.deactivateText)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.deactivateConfirm }));
    expect(hooks.deactivate.mutate).toHaveBeenCalledTimes(1);
  });

  it('себя уволить нельзя: пункт не открывает подтверждение', () => {
    render(<EmployeeActionsMenu card={card({ id: ME })} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.deactivateEmployee }));
    expect(screen.queryByText(ui.employees.deactivateText)).toBeNull();
    expect(hooks.deactivate.mutate).not.toHaveBeenCalled();
  });

  it('уволенный — «Вернуть в работу» без подтверждения', () => {
    render(<EmployeeActionsMenu card={card({ status: 'deactivated' })} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.activateEmployee }));
    expect(hooks.activate.mutate).toHaveBeenCalledTimes(1);
  });

  it('дать администратора — роль admin добавляется к имеющимся', () => {
    render(<EmployeeActionsMenu card={card()} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.grantAdmin }));
    fireEvent.click(screen.getByRole('button', { name: ui.employees.grantAdmin }));
    expect(hooks.update.mutate).toHaveBeenCalledWith({
      roleIds: [EMPLOYEE_ROLE.id, ADMIN_ROLE.id],
    });
  });

  it('снять администратора — только роль admin уходит', () => {
    render(<EmployeeActionsMenu card={card({ roles: [EMPLOYEE_ROLE, ADMIN_ROLE] })} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.revokeAdmin }));
    fireEvent.click(screen.getByRole('button', { name: ui.employees.revokeAdmin }));
    expect(hooks.update.mutate).toHaveBeenCalledWith({ roleIds: [EMPLOYEE_ROLE.id] });
  });

  it('у уволенного нет управления администратором', () => {
    render(<EmployeeActionsMenu card={card({ status: 'deactivated' })} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.employees.grantAdmin })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: ui.employees.revokeAdmin })).toBeNull();
  });

  it('у уволенного нет «Восстановить доступ»: только «Вернуть в работу»', () => {
    render(<EmployeeActionsMenu card={card({ status: 'deactivated' })} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /Восстановить доступ/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: ui.employees.resetLink })).toBeNull();
  });

  it('себе сброс пароля не показывается (#101, 23.11.2026)', () => {
    render(<EmployeeActionsMenu card={card({ id: ME })} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.employees.resetLink })).toBeNull();
  });

  it('без права user.manage пункт сброса пароля скрыт (#101)', () => {
    useAuthStore.setState({
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    render(<EmployeeActionsMenu card={card()} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.employees.resetLink })).toBeNull();
  });

  it('сброс пароля — только после подтверждения (#101): сессии не гасятся случайным кликом', async () => {
    hooks.reset.mutateAsync.mockResolvedValue({
      id: 'user-1',
      token: 'r'.repeat(64),
      path: `/reset/${'r'.repeat(64)}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    render(<EmployeeActionsMenu card={card()} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.resetLink }));
    expect(hooks.reset.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(ui.employees.resetConfirmText)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.resetLink }));
    await waitFor(() => expect(hooks.reset.mutateAsync).toHaveBeenCalledTimes(1));
  });

  it('приглашённый: «Выпустить новую ссылку» открывает окно ссылки', async () => {
    hooks.reissue.mutateAsync.mockResolvedValue({
      id: 'user-1',
      token: 'r'.repeat(64),
      path: `/invite/${'r'.repeat(64)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(<EmployeeActionsMenu card={card({ status: 'invited' })} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.inviteReissue }));
    await waitFor(() => expect(hooks.reissue.mutateAsync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(ui.employees.inviteLinkTitle)).toBeTruthy();
  });

  it('приглашённый: отмена — через подтверждение, затем закрывает карточку', async () => {
    hooks.cancel.mutateAsync.mockResolvedValue(undefined);
    const onCloseCard = vi.fn();
    render(<EmployeeActionsMenu card={card({ status: 'invited' })} onCloseCard={onCloseCard} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.inviteCancel }));
    expect(screen.getByText(ui.employees.inviteCancelText)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteCancelConfirm }));
    await waitFor(() => expect(hooks.cancel.mutateAsync).toHaveBeenCalledTimes(1));
    expect(onCloseCard).toHaveBeenCalledTimes(1);
  });
});
