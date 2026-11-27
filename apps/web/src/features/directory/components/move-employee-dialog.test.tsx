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

const options = [
  { id: TARGET, name: 'BIM-отдел', depth: 0, isActive: true, headId: null, deputyIds: [] },
  {
    id: OTHER,
    name: 'Проектный отдел',
    depth: 0,
    isActive: true,
    headId: null,
    deputyIds: [],
  },
];

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
        departmentOptions={options}
        onMoved={onMoved}
      />,
    );

    expect(screen.getByText('BIM-отдел')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /in-target/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /dismissed/ })).toBeNull();
    const row = screen.getByRole('button', { name: /from-other/ });
    // В строке — текущее подразделение: куда переезжает человек, видно ДО выбора.
    expect(row.textContent).toContain('Проектный отдел');

    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    // Внизу — ОТКУДА человек уходит (грамматика окна правки подразделения):
    // выбранный не теряется, даже если поиск скрыл его строку.
    const source = screen.getByRole('status');
    expect(source.textContent).toContain('from-other');
    expect(source.textContent).toContain(ui.employees.leaderTransferFromOne);
    expect(source.textContent).toContain('Проектный отдел');
    fireEvent.click(screen.getByRole('button', { name: ui.employees.transferEmployeeSubmit }));
    expect(onMoved).toHaveBeenCalledWith('from-other');
  });

  it('сотрудник без подразделения: строка-источник — «без подразделения»', () => {
    render(
      <MoveEmployeeDialog
        open
        onOpenChange={vi.fn()}
        department={node}
        users={[person('orphan')]}
        departmentOptions={options}
        onMoved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /orphan/ }));
    expect(screen.getByRole('status').textContent).toContain(
      ui.employees.transferEmployeeNoDepartmentInline,
    );
  });

  it('поиск фильтрует список и показывает заглушку пустого результата', () => {
    render(
      <MoveEmployeeDialog
        open
        onOpenChange={vi.fn()}
        department={node}
        users={[person('from-other', { departmentId: OTHER })]}
        departmentOptions={options}
        onMoved={vi.fn()}
      />,
    );

    const search = screen.getByRole('textbox', { name: ui.employees.transferEmployeeSearch });
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(ui.employees.transferEmployeeNotFound)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /from-other/ })).toBeNull();

    fireEvent.change(search, { target: { value: 'from' } });
    expect(screen.getByRole('button', { name: /from-other/ })).toBeTruthy();
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
