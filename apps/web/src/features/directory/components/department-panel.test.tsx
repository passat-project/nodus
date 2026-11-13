// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DepartmentPanel } from './department-panel.js';

/**
 * Правая панель подразделения: счётчики штата (#723) и секция «Руководители»
 * со ВСЕМИ заместителями (#817) — уволенный заместитель остаётся строкой,
 * потому что ссылка на него в оргструктуре сохраняется.
 */

vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../api/directory-api.js', () => ({
  useArchiveDepartment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';
const HEAD_ID = '22222222-2222-4222-8222-222222222222';
const DEPUTY_A = '33333333-3333-4333-8333-333333333333';
const DEPUTY_B = '44444444-4444-4444-8444-444444444444';

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
  person(DEPUTY_A, 'active', { departmentId: DEPARTMENT_ID }),
  // Уволенный заместитель: строка связи осталась в БД, но в узел не приходит.
  person(DEPUTY_B, 'deactivated', { departmentId: null }),
];

const node: DepartmentNode = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: HEAD_ID,
  deputyIds: [DEPUTY_A, DEPUTY_B],
  sortOrder: 0,
  isActive: true,
  headName: HEAD_ID,
  deputies: [
    { id: DEPUTY_A, displayName: DEPUTY_A },
    { id: DEPUTY_B, displayName: DEPUTY_B },
  ],
  memberCount: 0,
  children: [],
};

/** `NodeLabel` держит подпись и число в одном span: textContent = подпись+число. */
const labelText = (label: string) => screen.getByText(label).textContent;

function renderPanel(overrides: Partial<DepartmentNode> = {}) {
  render(
    <DepartmentPanel
      kind="management"
      node={{ ...node, ...overrides }}
      users={users}
      topShift={0}
      onClose={vi.fn()}
      onInvite={vi.fn()}
      onCreateChild={vi.fn()}
      onEdit={vi.fn()}
      canManage={false}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('DepartmentPanel: счётчики штата (#723)', () => {
  it('сотрудники и подчинённые считаются по действующим, уволенный виден строкой', () => {
    renderPanel();

    // В подразделении трое действующих, из них один подчинённый уволен.
    expect(labelText(ui.employees.panelMembers)).toBe(`${ui.employees.panelMembers}3`);
    // Подчинённых руководителя двое, из них один уволен.
    expect(labelText(ui.employees.panelReports)).toBe(`${ui.employees.panelReports}1`);
    // Строки уволенных не скрываются — архив доступен из панели.
    expect(screen.getAllByText('head-dismissed').length).toBeGreaterThan(0);
  });
});

describe('DepartmentPanel: заместители (#817)', () => {
  it('показывает всех заместителей из узла (API отдаёт только действующих)', () => {
    renderPanel();

    expect(screen.getByText(ui.employees.panelDeputies)).toBeTruthy();
    // Заместители есть и в составе подразделения — строк, а не одна.
    expect(screen.getAllByText(DEPUTY_A).length).toBeGreaterThan(0);
    expect(screen.getAllByText(DEPUTY_B).length).toBeGreaterThan(0);
  });

  it('уволенный заместитель в панель не попадает, даже если он есть в справочнике', () => {
    // API не отдаёт уволенного в deputies — в узле только действующий.
    renderPanel({
      deputyIds: [DEPUTY_A],
      deputies: [{ id: DEPUTY_A, displayName: DEPUTY_A }],
    });

    expect(screen.getAllByText(DEPUTY_A).length).toBeGreaterThan(0);
    expect(screen.queryByText(DEPUTY_B)).toBeNull();
  });

  it('без заместителей секция не рисуется (нет пустой подписи)', () => {
    renderPanel({ deputyIds: [], deputies: [] });

    expect(screen.queryByText(ui.employees.panelDeputies)).toBeNull();
  });

  it('имя заместителя берётся из узла, если его нет в загруженном справочнике', () => {
    const stranger = '55555555-5555-4555-8555-555555555555';
    renderPanel({
      deputyIds: [stranger],
      deputies: [{ id: stranger, displayName: 'Внешний Заместитель' }],
    });

    expect(screen.getByText('Внешний Заместитель')).toBeTruthy();
  });
});
