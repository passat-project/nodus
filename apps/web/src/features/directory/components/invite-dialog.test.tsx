// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { InviteDialog } from './invite-dialog.js';

const createInvitation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock('../api/directory-api.js', () => ({
  useCreateInvitation: () => createInvitation,
  usePositions: () => ({
    data: [
      {
        id: '00000000-0000-4000-9000-000000000001',
        name: 'Инженер-проектировщик',
        kind: 'management',
      },
    ],
  }),
}));

vi.mock('../../../shared/api/departments-list.js', () => ({
  useDepartmentsList: () => [
    {
      id: '00000000-0000-4000-9000-000000000002',
      name: 'Проектный отдел',
      depth: 0,
      isActive: true,
      headId: null,
      deputyId: null,
    },
  ],
}));

vi.mock('./reference-combobox.js', () => ({
  ReferenceCombobox: ({
    value,
    onChange,
    options,
    ariaLabel,
  }: {
    value: string | null;
    onChange: (id: string | null) => void;
    options: { id: string; label: string }[];
    ariaLabel: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">—</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('InviteDialog (#101)', () => {
  it('обязательные поля и предвыбранный отдел уходят в приглашение, затем — ссылка', async () => {
    createInvitation.mutateAsync.mockResolvedValue({
      id: 'user-1',
      token: 't'.repeat(64),
      path: `/invite/${'t'.repeat(64)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    render(
      <InviteDialog
        open
        onOpenChange={() => undefined}
        initialDepartmentId="00000000-0000-4000-9000-000000000002"
      />,
    );

    fireEvent.change(screen.getByLabelText(ui.employees.inviteLastName), {
      target: { value: 'Новиков' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.inviteFirstName), {
      target: { value: 'Иван' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.inviteEmail), {
      target: { value: 'New.Hire@Nodus.by' },
    });
    fireEvent.change(screen.getByLabelText(ui.employees.invitePosition), {
      target: { value: '00000000-0000-4000-9000-000000000001' },
    });

    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteSubmit }));

    await waitFor(() => expect(createInvitation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(createInvitation.mutateAsync).toHaveBeenCalledWith({
      email: 'new.hire@nodus.by',
      lastName: 'Новиков',
      firstName: 'Иван',
      middleName: null,
      positionId: '00000000-0000-4000-9000-000000000001',
      departmentId: '00000000-0000-4000-9000-000000000002',
    });

    expect(await screen.findByText(ui.employees.inviteLinkTitle)).toBeTruthy();
    const link = screen.getByLabelText(ui.employees.inviteLinkLabel) as HTMLInputElement;
    expect(link.value).toContain('/invite/');
  });

  it('без обязательных полей приглашение не уходит', () => {
    render(<InviteDialog open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteSubmit }));
    expect(createInvitation.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(ui.employees.inviteRequired);
  });
});
