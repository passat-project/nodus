// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { MoveEmployeeDialog } from './move-employee-dialog.js';

/** #881: пикер перевода показывает только активных из ДРУГИХ подразделений. */

const TARGET = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

vi.mock('../api/department-actions-api.js', () => ({
  useTransferEmployee: () => ({
    mutate: vi.fn((_vars: unknown, options: { onSuccess?: () => void }) => options.onSuccess?.()),
    isPending: false,
  }),
}));

vi.mock('./employee-combobox.js', () => ({
  EmployeeCombobox: ({
    users,
    onChange,
  }: {
    users: UserListItem[];
    onChange: (id: string) => void;
  }) => (
    <select aria-label="employee" onChange={(event) => onChange(event.target.value)}>
      <option value="">—</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.displayName}
        </option>
      ))}
    </select>
  ),
}));

const person = (id: string, overrides: Partial<UserListItem> = {}): UserListItem => ({
  id,
  displayName: id,
  status: 'active',
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId: null,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
  ...overrides,
});

const node: DepartmentNode = {
  id: TARGET,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: 'root',
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 0,
  children: [],
};

afterEach(() => cleanup());

describe('MoveEmployeeDialog (#881)', () => {
  it('предлагает активных из других подразделений и переводит выбранного', () => {
    const onMoved = vi.fn();
    render(
      <MoveEmployeeDialog
        open
        onOpenChange={vi.fn()}
        department={node}
        users={[
          person('in-target', { departmentId: TARGET }),
          person('from-other', { departmentId: OTHER }),
          person('dismissed', { status: 'deactivated', departmentId: OTHER }),
        ]}
        departmentOptions={[
          { id: TARGET, name: 'BIM-отдел', depth: 0, isActive: true, headId: null, deputyIds: [] },
          {
            id: OTHER,
            name: 'Проектный отдел',
            depth: 0,
            isActive: true,
            headId: null,
            deputyIds: [],
          },
        ]}
        onMoved={onMoved}
      />,
    );

    const picker = screen.getByRole('combobox', { name: 'employee' });
    expect(screen.getByRole('option', { name: 'from-other' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'in-target' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'dismissed' })).toBeNull();

    fireEvent.change(picker, { target: { value: 'from-other' } });
    expect(screen.getByText(new RegExp(ui.employees.transferEmployeeCurrent))).toBeTruthy();
    expect(screen.getByText(/Проектный отдел/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.employees.transferEmployeeSubmit }));
    expect(onMoved).toHaveBeenCalledWith('from-other');
  });

  it('без кандидатов показывает пустое состояние и не даёт перевести', () => {
    render(
      <MoveEmployeeDialog
        open
        onOpenChange={vi.fn()}
        department={node}
        users={[person('in-target', { departmentId: TARGET })]}
        departmentOptions={[]}
        onMoved={vi.fn()}
      />,
    );

    expect(screen.getByText(ui.employees.transferEmployeeEmpty)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: ui.employees.transferEmployeeSubmit })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
});
