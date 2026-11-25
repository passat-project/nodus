// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DeleteDepartmentDialog } from './delete-department-dialog.js';

/** #881: подтверждение удаления — числа по активным, уволенные отдельной строкой. */

const TARGET = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';

vi.mock('../api/department-actions-api.js', () => ({
  useDeleteDepartment: () => ({
    mutate: vi.fn((_id: string, options: { onSuccess?: () => void }) => options.onSuccess?.()),
    isPending: false,
  }),
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
  departmentId: TARGET,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
  ...overrides,
});

const node = (children: DepartmentNode[] = []): DepartmentNode => ({
  id: TARGET,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: PARENT,
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 0,
  children,
});

const child = (id: string): DepartmentNode => ({
  ...node(),
  id,
  name: id,
  parentId: TARGET,
  children: [],
});

afterEach(() => cleanup());

describe('DeleteDepartmentDialog (#881)', () => {
  it('считает активных детей и сотрудников, уволенных поясняет отдельно', () => {
    const onDeleted = vi.fn();
    render(
      <DeleteDepartmentDialog
        open
        onOpenChange={vi.fn()}
        department={node([child('child-1'), child('child-2')])}
        parentName="Компания"
        users={[
          person('active-1'),
          person('active-2'),
          person('dismissed', { status: 'deactivated' }),
          person('invited', { status: 'invited' }),
          person('other', { departmentId: PARENT }),
        ]}
        onDeleted={onDeleted}
      />,
    );

    expect(screen.getByText(/2 подразделения и 2 сотрудника перейдут в «Компания»/)).toBeTruthy();
    expect(screen.getByText(ui.employees.deleteDepartmentDismissedHint)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.employees.deleteDepartmentConfirm }));
    expect(onDeleted).toHaveBeenCalledWith(PARENT);
  });

  it('приглашённый не считается уволенным в подсказке', () => {
    render(
      <DeleteDepartmentDialog
        open
        onOpenChange={vi.fn()}
        department={node()}
        parentName="Компания"
        users={[person('invited', { status: 'invited' })]}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.queryByText(ui.employees.deleteDepartmentDismissedHint)).toBeNull();
  });

  it('пустое подразделение — без чисел переезда', () => {
    render(
      <DeleteDepartmentDialog
        open
        onOpenChange={vi.fn()}
        department={node()}
        parentName="Компания"
        users={[]}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByText(ui.employees.deleteDepartmentEmpty)).toBeTruthy();
    expect(screen.queryByText(ui.employees.deleteDepartmentDismissedHint)).toBeNull();
  });
});
