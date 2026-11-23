// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../../../shared/api-client.js';
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
    {
      id: '00000000-0000-4000-9000-000000000003',
      name: 'Строительный отдел',
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

const LAST_NAME = '00000000-0000-4000-9000-000000000001';
const DEPARTMENT_A = '00000000-0000-4000-9000-000000000002';
const DEPARTMENT_B = '00000000-0000-4000-9000-000000000003';

function fillRequired(overrides: { email?: string } = {}): void {
  fireEvent.change(screen.getByLabelText(/Фамилия/), { target: { value: 'Новиков' } });
  fireEvent.change(screen.getByLabelText(/^Имя/), { target: { value: 'Иван' } });
  fireEvent.change(screen.getByLabelText(/Рабочая почта/), {
    target: { value: overrides.email ?? 'New.Hire@Nodus.by' },
  });
  fireEvent.change(screen.getByLabelText(ui.employees.invitePosition), {
    target: { value: LAST_NAME },
  });
}

afterEach(() => {
  cleanup();
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

    render(<InviteDialog open onOpenChange={() => undefined} initialDepartmentId={DEPARTMENT_A} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteSubmit }));

    await waitFor(() => expect(createInvitation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(createInvitation.mutateAsync).toHaveBeenCalledWith({
      email: 'new.hire@nodus.by',
      lastName: 'Новиков',
      firstName: 'Иван',
      middleName: null,
      positionId: LAST_NAME,
      departmentId: DEPARTMENT_A,
    });

    expect(await screen.findByText(ui.employees.inviteLinkTitle)).toBeTruthy();
    const link = screen.getByRole('textbox', { name: ui.employees.inviteLinkLabel });
    expect(link.textContent).toContain('/invite/');
    // Ссылка не обрезается молча: полная — в title строки (после многоточия).
    expect(link.getAttribute('title')).toBe(link.textContent);
  });

  it('«Далее» недоступна, пока не заполнены обязательные поля', () => {
    render(<InviteDialog open onOpenChange={() => undefined} />);
    const next = screen.getByRole('button', {
      name: ui.employees.inviteSubmit,
    }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fillRequired();
    fireEvent.change(screen.getByLabelText(ui.employees.inviteDepartment), {
      target: { value: DEPARTMENT_A },
    });
    expect(next.disabled).toBe(false);
  });

  it('незаполненное поле показывает ошибку по полю, а не общий текст', () => {
    render(<InviteDialog open onOpenChange={() => undefined} />);
    const lastName = screen.getByLabelText(/Фамилия/);
    fireEvent.blur(lastName);
    expect(screen.getByText(ui.employees.inviteLastNameRequired)).toBeTruthy();
    expect(lastName.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(ui.employees.inviteRequired)).toBeNull();
  });

  it('некорректная почта — ошибка под полем после отправки', () => {
    render(<InviteDialog open onOpenChange={() => undefined} initialDepartmentId={DEPARTMENT_A} />);
    fillRequired({ email: 'not-an-email' });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteSubmit }));
    expect(createInvitation.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(ui.employees.inviteEmailRequired)).toBeTruthy();
  });

  it('дубль почты с сервера — inline под «Рабочей почтой», без тоста', async () => {
    createInvitation.mutateAsync.mockRejectedValue(
      new ApiError(ErrorCode.DIRECTORY_EMAIL_TAKEN, 'Email already exists', 409),
    );
    render(<InviteDialog open onOpenChange={() => undefined} initialDepartmentId={DEPARTMENT_A} />);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteSubmit }));
    await waitFor(() =>
      expect(screen.getByText('Пользователь с таким email уже существует')).toBeTruthy(),
    );
    const email = screen.getByLabelText(/Рабочая почта/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });

  it('повторное открытие из другого подразделения подставляет его отдел', () => {
    const { rerender } = render(
      <InviteDialog open onOpenChange={() => undefined} initialDepartmentId={DEPARTMENT_A} />,
    );
    const department = () =>
      screen.getByLabelText(ui.employees.inviteDepartment) as HTMLSelectElement;
    expect(department().value).toBe(DEPARTMENT_A);

    rerender(
      <InviteDialog
        open={false}
        onOpenChange={() => undefined}
        initialDepartmentId={DEPARTMENT_A}
      />,
    );
    rerender(
      <InviteDialog open onOpenChange={() => undefined} initialDepartmentId={DEPARTMENT_B} />,
    );
    expect(department().value).toBe(DEPARTMENT_B);
  });
});
