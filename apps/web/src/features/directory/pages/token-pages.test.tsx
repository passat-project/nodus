// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { ApiError } from '../../../shared/api-client.js';
import { InviteAcceptPage } from './invite-accept-page.js';
import { PasswordResetPage } from './password-reset-page.js';

const hooks = vi.hoisted(() => ({
  info: {} as Record<string, unknown>,
  reset: {} as Record<string, unknown>,
  accept: vi.fn(),
  acceptReset: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ token: 'token-1' }),
}));

vi.mock('../api/invitation-public-api.js', () => ({
  useInvitationInfo: () => hooks.info,
  usePasswordResetInfo: () => hooks.reset,
  useAcceptInvitation: () => ({ mutateAsync: hooks.accept }),
  useAcceptPasswordReset: () => ({ mutateAsync: hooks.acceptReset }),
}));

vi.mock('../components/token-password-form.js', () => ({
  TokenPasswordForm: ({ mode }: { mode: string }) => <div>form:{mode}</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('публичные страницы приглашения/сброса (#101)', () => {
  it('приглашение: загрузка → недействительная ссылка → форма', () => {
    hooks.info = { isLoading: true, isError: false, data: undefined };
    const { rerender } = render(<InviteAcceptPage />);
    expect(screen.getByText(ui.common.loading)).toBeTruthy();

    hooks.info = {
      isLoading: false,
      isError: true,
      error: new ApiError('INVITATION_INVALID', 'bad', 400),
      data: undefined,
    };
    rerender(<InviteAcceptPage />);
    expect(screen.getByText(ui.employees.invitePageInvalid)).toBeTruthy();

    hooks.info = {
      isLoading: false,
      isError: true,
      error: new ApiError('INVITATION_ALREADY_USED', 'used', 409),
      data: undefined,
    };
    rerender(<InviteAcceptPage />);
    expect(screen.getByText(ui.employees.invitePageUsed)).toBeTruthy();

    hooks.info = {
      isLoading: false,
      isError: false,
      data: {
        kind: 'invite',
        displayName: 'Новиков Иван',
        email: 'new@nodus.by',
        departmentName: 'Отдел',
        positionName: 'Инженер',
        expiresAt: new Date().toISOString(),
      },
    };
    rerender(<InviteAcceptPage />);
    expect(screen.getByText('form:invite')).toBeTruthy();
  });

  it('сброс: загрузка → недействительная ссылка → форма', () => {
    hooks.reset = { isLoading: true, isError: false, data: undefined };
    const { rerender } = render(<PasswordResetPage />);
    expect(screen.getByText(ui.common.loading)).toBeTruthy();

    hooks.reset = {
      isLoading: false,
      isError: true,
      error: new ApiError('PASSWORD_RESET_INVALID', 'bad', 400),
      data: undefined,
    };
    rerender(<PasswordResetPage />);
    expect(screen.getByText(ui.employees.resetPageInvalid)).toBeTruthy();

    hooks.reset = {
      isLoading: false,
      isError: false,
      data: {
        kind: 'reset',
        displayName: 'Воронич Алина',
        email: 'a@nodus.by',
        expiresAt: new Date().toISOString(),
      },
    };
    rerender(<PasswordResetPage />);
    expect(screen.getByText('form:reset')).toBeTruthy();
  });
});
