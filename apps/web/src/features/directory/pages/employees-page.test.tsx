// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { EmployeesPage } from './employees-page.js';

/**
 * Счётчик шапки «Сотрудники» (#723): число — штат (действующие), а не длина
 * выдачи справочника. Уволенный остаётся строкой журнала, но в счёт не входит —
 * так же считает карточка «Сотрудники» на Главной.
 */

const demo = vi.hoisted(() => {
  const item = (id: string, status: 'active' | 'deactivated') => ({
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
  });
  return {
    items: [
      item('a-active', 'active'),
      item('b-active', 'active'),
      item('c-dismissed', 'deactivated'),
    ],
  };
});

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/directory' } }),
}));
vi.mock('../api/directory-api.js', () => ({
  useUsersList: () => ({ data: { items: demo.items }, isLoading: false }),
  useDepartmentTree: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
// Тот же хук справочника зовёт реестр фильтров — подменяем и его модуль.
vi.mock('../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({ data: { items: demo.items } }),
}));
vi.mock('../lib/use-header-geometry.js', () => ({
  useHeaderGeometry: () => ({ rootRef: { current: null }, topShift: 0, rowWidth: 1200 }),
}));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));
// Тяжёлые оверлеи страницы не участвуют в проверке счётчика.
vi.mock('../components/data-check-dialog.js', () => ({ DataCheckDialog: () => null }));
vi.mock('../components/department-dialog.js', () => ({ DepartmentDialog: () => null }));
vi.mock('../components/invite-dialog.js', () => ({ InviteDialog: () => null }));
vi.mock('../components/positions-dialog.js', () => ({ PositionsDialog: () => null }));

afterEach(() => {
  cleanup();
});

describe('EmployeesPage: счётчик шапки (#723)', () => {
  it('в заголовке штат — действующие, а не длина выдачи справочника', () => {
    const active = demo.items.filter((user) => user.status === 'active').length;
    expect(active).toBeLessThan(demo.items.length);

    render(<EmployeesPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(`${ui.employees.title}${active}`);
    expect(heading.textContent).not.toBe(`${ui.employees.title}${demo.items.length}`);
  });
});
