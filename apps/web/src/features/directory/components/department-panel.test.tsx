// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DepartmentPanel } from './department-panel.js';

/**
 * Правая панель подразделения (#768): две группы — «Руководители»
 * (руководитель + зам, даже не члены) и «Подчинённые» (активные члены;
 * в главной карточке — ещё и без подразделения/с архивным). Уволенные в
 * структуре не показываются, секции по managerId нет.
 */

vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';
const HEAD_ID = '22222222-2222-4222-8222-222222222222';
const DEPUTY_ID = '33333333-3333-4333-8333-333333333333';
const ORPHAN_ID = '44444444-4444-4444-8444-444444444444';
const ARCHIVED_DEPARTMENT_ID = '55555555-5555-4555-8555-555555555555';

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
  person(DEPUTY_ID, 'active'),
  person('member-active', 'active', { departmentId: DEPARTMENT_ID, managerId: HEAD_ID }),
  person('member-other', 'active', { departmentId: DEPARTMENT_ID }),
  person('member-dismissed', 'deactivated', { departmentId: DEPARTMENT_ID }),
  person(ORPHAN_ID, 'active'),
  person('archived-member', 'active', { departmentId: ARCHIVED_DEPARTMENT_ID }),
];

const node: DepartmentNode = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: HEAD_ID,
  deputyIds: [DEPUTY_ID],
  sortOrder: 0,
  isActive: true,
  headName: HEAD_ID,
  deputies: [{ id: DEPUTY_ID, displayName: DEPUTY_ID }],
  memberCount: 0,
  children: [],
};

const activeIds = new Set([DEPARTMENT_ID]);
const labelText = (label: string) => screen.getByText(label).textContent;

afterEach(() => {
  cleanup();
});

function mount(overrides: { mainCard?: boolean; highlightUserId?: string | null } = {}) {
  render(
    <DepartmentPanel
      mainCard={overrides.mainCard ?? false}
      node={node}
      users={users}
      activeDepartmentIds={activeIds}
      highlightUserId={overrides.highlightUserId ?? null}
      topShift={0}
      onInvite={vi.fn()}
      onEdit={vi.fn()}
      onTransfer={vi.fn()}
      onDelete={vi.fn()}
      canManage={false}
    />,
  );
}

describe('DepartmentPanel: группы и активные сотрудники (#768)', () => {
  it('руководители и подчинённые считаются по активным; уволенный не показан', () => {
    mount();

    expect(labelText(ui.employees.panelHeads)).toBe(`${ui.employees.panelHeads}2`);
    expect(labelText(ui.employees.subordinates)).toBe(`${ui.employees.subordinates}2`);
    expect(screen.getAllByText('member-active').length).toBeGreaterThan(0);
    expect(screen.queryByText('member-dismissed')).toBeNull();
    // И руководитель, и зам — в «Руководителях», в «Подчинённых» не дублируются.
    expect(screen.getAllByText(HEAD_ID)).toHaveLength(1);
    expect(screen.getAllByText(DEPUTY_ID)).toHaveLength(1);
  });

  it('в «Руководителях» подписаны роли: руководитель и заместитель', () => {
    mount();

    expect(screen.getByText(ui.employees.fieldHead)).toBeTruthy();
    expect(screen.getByText(ui.employees.fieldDeputy)).toBeTruthy();
  });

  it('в главной карточке компании в «Подчинённых» — сотрудники без подразделения и с архивным', () => {
    mount({ mainCard: true });

    expect(labelText(ui.employees.subordinates)).toBe(`${ui.employees.subordinates}4`);
    expect(screen.getAllByText(ORPHAN_ID).length).toBeGreaterThan(0);
    expect(screen.getAllByText('archived-member').length).toBeGreaterThan(0);
  });

  it('в меню панели нет «Добавить подразделение»: создание — плюсом на карточке', async () => {
    render(
      <DepartmentPanel
        mainCard={false}
        node={node}
        users={users}
        activeDepartmentIds={activeIds}
        highlightUserId={null}
        topShift={0}
        onInvite={vi.fn()}
        onEdit={vi.fn()}
        onTransfer={vi.fn()}
        onDelete={vi.fn()}
        canManage
      />,
    );

    const trigger = screen.getByRole('button', { name: ui.employees.departmentActions });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(trigger);

    expect(
      await screen.findByRole('menuitem', { name: new RegExp(ui.employees.inviteToDepartment) }),
    ).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: new RegExp(ui.employees.transferFromDepartment) }),
    ).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: new RegExp(ui.employees.deleteDepartment) }),
    ).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: ui.employees.addSubdepartment })).toBeNull();
  });

  it('секции «Подчинённые руководителя» по managerId больше нет', () => {
    mount();
    expect(screen.queryByText('Подчинённые руководителя')).toBeNull();
  });
});
