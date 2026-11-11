// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DepartmentPanel } from './department-panel.js';

/**
 * Счётчики правой панели подразделения (#723): «Сотрудники подразделения» и
 * «Подчинённые руководителя» показывают штат (действующих), как `memberCount`
 * на API; уволенные остаются строками списка и открываются в карточке.
 */

vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../api/directory-api.js', () => ({
  useArchiveDepartment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';
const HEAD_ID = '22222222-2222-4222-8222-222222222222';

const person = (
  id: string,
  status: UserListItem['status'],
  overrides: Partial<UserListItem> = {},
): UserListItem => ({
  id,
  displayName: id,
  status,
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

const users: UserListItem[] = [
  person(HEAD_ID, 'active', { departmentId: DEPARTMENT_ID }),
  person('head-active', 'active', { departmentId: DEPARTMENT_ID, managerId: HEAD_ID }),
  person('head-dismissed', 'deactivated', { departmentId: DEPARTMENT_ID, managerId: HEAD_ID }),
];

const node: DepartmentNode = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: HEAD_ID,
  deputyId: null,
  sortOrder: 0,
  isActive: true,
  headName: HEAD_ID,
  deputyName: null,
  memberCount: 0,
  children: [],
};

/** `NodeLabel` держит подпись и число в одном span: textContent = подпись+число. */
const labelText = (label: string) => screen.getByText(label).textContent;

afterEach(() => {
  cleanup();
});

describe('DepartmentPanel: счётчики штата (#723)', () => {
  it('сотрудники и подчинённые считаются по действующим, уволенный виден строкой', () => {
    render(
      <DepartmentPanel
        kind="management"
        node={node}
        users={users}
        topShift={0}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onCreateChild={vi.fn()}
        onEdit={vi.fn()}
        canManage={false}
      />,
    );

    // В подразделении трое, из них один уволен.
    expect(labelText(ui.employees.panelMembers)).toBe(`${ui.employees.panelMembers}2`);
    // Подчинённых руководителя двое, из них один уволен.
    expect(labelText(ui.employees.panelReports)).toBe(`${ui.employees.panelReports}1`);
    // Строки уволенных не скрываются — архив доступен из панели.
    expect(screen.getAllByText('head-dismissed').length).toBeGreaterThan(0);
  });
});
