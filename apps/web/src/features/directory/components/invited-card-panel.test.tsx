// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserCard } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { InvitedCardPanel } from './invited-card-panel.js';

const hooks = vi.hoisted(() => ({
  reissue: { mutateAsync: vi.fn(), isPending: false },
  cancel: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('../api/directory-api.js', () => ({
  useReissueInvitation: () => hooks.reissue,
  useCancelInvitation: () => hooks.cancel,
}));

const CARD = { id: 'user-1', displayName: 'Новиков Иван', status: 'invited' } as UserCard;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvitedCardPanel (#101)', () => {
  it('до активации объясняет ограничения; без права управления действий нет', () => {
    render(<InvitedCardPanel card={CARD} canManage={false} onClose={() => undefined} />);
    expect(screen.getByText(ui.employees.invitedCardTitle)).toBeTruthy();
    expect(screen.getByText(ui.employees.invitedCardText)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.employees.inviteReissue })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.employees.inviteCancel })).toBeNull();
  });

  it('перевыпуск показывает одноразовую ссылку в окне', async () => {
    hooks.reissue.mutateAsync.mockResolvedValue({
      id: 'user-1',
      token: 'r'.repeat(64),
      path: `/invite/${'r'.repeat(64)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    render(<InvitedCardPanel card={CARD} canManage onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteReissue }));
    await waitFor(() => expect(hooks.reissue.mutateAsync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(ui.employees.inviteLinkTitle)).toBeTruthy();
    const link = screen.getByRole('textbox', { name: ui.employees.inviteLinkLabel });
    expect(link.textContent).toContain('/invite/');
  });

  it('отмена — через подтверждение, затем закрывает карточку', async () => {
    hooks.cancel.mutateAsync.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<InvitedCardPanel card={CARD} canManage onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteCancel }));
    expect(screen.getByText(ui.employees.inviteCancelText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteCancelConfirm }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
