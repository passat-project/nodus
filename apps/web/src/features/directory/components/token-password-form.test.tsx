// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, InvitationInfo, PasswordResetInfo } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../../../shared/api-client.js';
import { TokenPasswordForm } from './token-password-form.js';

const auth = vi.hoisted(() => ({
  login: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  user: null as AuthUser | null,
  navigate: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => auth.navigate }));
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ login: auth.login, logout: auth.logout, user: auth.user }),
}));

const INFO: InvitationInfo = {
  kind: 'invite',
  displayName: 'Новиков Иван',
  email: 'new@nodus.by',
  departmentName: 'Проектный отдел',
  positionName: 'Инженер',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const RESET: PasswordResetInfo = {
  kind: 'reset',
  displayName: 'Воронич Алина',
  email: 'a.voronich@nodus.by',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.user = null;
});

describe('TokenPasswordForm (#101)', () => {
  it('подсказка политики видна и на приглашении, и на сбросе', () => {
    const { unmount } = render(<TokenPasswordForm info={INFO} mode="invite" onAccept={vi.fn()} />);
    expect(screen.getByText(ui.employees.invitePagePasswordHint)).toBeTruthy();
    unmount();
    render(<TokenPasswordForm info={RESET} mode="reset" onAccept={vi.fn()} />);
    expect(screen.getByText(ui.employees.invitePagePasswordHint)).toBeTruthy();
  });

  it('слабый пароль — точная ошибка до запроса, без общего VALIDATION_FAILED', () => {
    const onAccept = vi.fn();
    render(<TokenPasswordForm info={INFO} mode="invite" onAccept={onAccept} />);
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePassword), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePasswordRepeat), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.invitePageSubmit }));
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain(ui.employees.passwordTooShort);
    expect(alert).toContain(ui.employees.passwordNeedsUpper);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('reset-страница: та же проверка политики', () => {
    const onAccept = vi.fn();
    render(<TokenPasswordForm info={RESET} mode="reset" onAccept={onAccept} />);
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePassword), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePasswordRepeat), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.resetPageSubmit }));
    expect(screen.getByRole('alert').textContent).toContain(ui.employees.passwordTooShort);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('несовпадение паролей — ошибка до запроса', () => {
    const onAccept = vi.fn();
    render(<TokenPasswordForm info={INFO} mode="invite" onAccept={onAccept} />);
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePassword), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePasswordRepeat), {
      target: { value: 'Strong#Pass124' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.invitePageSubmit }));
    expect(screen.getByRole('alert').textContent).toBe(ui.employees.passwordMismatch);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('успех: пароль с # проходит, accept → login → редирект на Главную', async () => {
    const onAccept = vi.fn(async () => ({ id: 'user-1', email: 'new@nodus.by' }));
    render(<TokenPasswordForm info={INFO} mode="invite" onAccept={onAccept} />);
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePassword), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePasswordRepeat), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.invitePageSubmit }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onAccept).toHaveBeenCalledWith({ email: 'new@nodus.by', password: 'Strong#Pass123' });
    expect(auth.login).toHaveBeenCalledWith('new@nodus.by', 'Strong#Pass123');
    expect(auth.navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('reset-страница показывает карточку сброса и сохраняет пароль', async () => {
    const onAccept = vi.fn(async () => ({ id: 'user-1', email: 'a.voronich@nodus.by' }));
    render(<TokenPasswordForm info={RESET} mode="reset" onAccept={onAccept} />);
    expect(screen.getByText(ui.employees.resetPageTitle)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePassword), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePasswordRepeat), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.resetPageSubmit }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(auth.login).toHaveBeenCalledWith('a.voronich@nodus.by', 'Strong#Pass123');
  });

  it('серверный VALIDATION_FAILED по паролю — адресная ошибка под полем', async () => {
    const onAccept = vi.fn(async () => {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, 'Validation failed', 400, {
        issues: [{ path: 'password', code: 'custom', message: 'Password policy' }],
      });
    });
    render(<TokenPasswordForm info={INFO} mode="invite" onAccept={onAccept} />);
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePassword), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePagePasswordRepeat), {
      target: { value: 'Strong#Pass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.invitePageSubmit }));
    expect(await screen.findByText(ui.employees.passwordInvalid)).toBeTruthy();
  });

  it('вошедший другой учёткой — сначала подтверждение смены сессии', () => {
    auth.user = {
      id: 'admin-1',
      email: 'admin@nodus.by',
      displayName: 'Админ',
      permissions: [],
    };
    const onAccept = vi.fn();
    render(<TokenPasswordForm info={INFO} mode="invite" onAccept={onAccept} />);
    expect(screen.getByText(/Продолжить вход под приглашённым сотрудником/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.invitePageContinue }));
    expect(screen.getByLabelText(ui.employees.invitePagePassword)).toBeTruthy();
  });
});
