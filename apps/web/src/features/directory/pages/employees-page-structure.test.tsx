// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { EmployeesPage } from './employees-page.js';

/**
 * Страница сотрудников (#768): вход в «Структуру» центрирует моё
 * подразделение и открывает постоянную панель, поиск выбирает
 * подразделение/сотрудника, «Должности» подменяют содержимое панели, старые
 * URL нормализуются. Компоненты канваса/панелей подменены — проверяется
 * композиция страницы.
 */

const node = (id: string, name: string, children: DepartmentNode[] = []): DepartmentNode => ({
  id,
  name,
  kind: 'management',
  parentId: null,
  headId: null,
  deputyId: null,
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputyName: null,
  memberCount: 1,
  children,
});

const person = (
  id: string,
  displayName: string,
  overrides: Partial<UserListItem> = {},
): UserListItem => ({
  id,
  displayName,
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

const users = [
  person('me', 'Ночная Анна', { departmentId: 'bim' }),
  person('other', 'Климович Александр', { departmentId: 'bim', status: 'deactivated' }),
];

const state = vi.hoisted(() => ({
  view: undefined as string | undefined,
  navigate: vi.fn(),
  users: [] as UserListItem[],
  tree: {
    data: [] as unknown[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  dept: null as Record<string, unknown> | null,
  divisions: null as Record<string, unknown> | null,
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ view: state.view }),
  useNavigate: () => state.navigate,
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: '/employees' } }),
}));
vi.mock('../api/directory-api.js', () => ({
  useUsersList: () => ({ data: { items: state.users }, isLoading: false }),
  useDepartmentTree: () => state.tree,
}));
vi.mock('../lib/use-header-geometry.js', () => ({
  useHeaderGeometry: () => ({ rootRef: { current: null }, topShift: 0, rowWidth: 1200 }),
}));
vi.mock('../lib/use-can-manage-directory.js', () => ({ useCanManageDirectory: () => true }));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (value: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'me' } }),
}));
vi.mock('../../../shared/views/use-list-toolbar.js', () => ({
  useListToolbar: () => ({ filters: [], query: '' }),
  useFilteredList: (items: unknown[]) => items,
}));
vi.mock('../../../shared/views/employee-filter-fields.js', () => ({
  useEmployeeFilterDefs: () => [],
  employeeSearchText: () => '',
}));
vi.mock('../../../shared/views/data-table.js', () => ({
  DataTable: () => <div data-testid="data-table" />,
}));
vi.mock('../../../shared/views/list-toolbar.js', () => ({
  ListToolbar: (props: { left?: ReactNode }) => <div data-testid="list-toolbar">{props.left}</div>,
}));
vi.mock('../components/divisions-view.js', () => ({
  DivisionsView: (props: Record<string, unknown>) => {
    state.divisions = props;
    return (
      <div data-testid="divisions-view" data-selected={(props.selectedId as string) ?? ''}>
        <button onClick={() => (props.onSelect as (id: string) => void)('main')}>
          select-main
        </button>
      </div>
    );
  },
}));
vi.mock('../components/structure-header.js', () => ({
  StructureHeader: (props: Record<string, unknown>) => (
    <div data-testid="structure-header">
      <button onClick={() => (props.onInvite as () => void)()}>invite</button>
      <button onClick={() => (props.onTogglePositions as () => void)()}>positions</button>
      <button onClick={() => (props.onPickDepartment as (id: string) => void)('bim')}>
        pick-dept
      </button>
      <button onClick={() => (props.onPickEmployee as (u: UserListItem) => void)(users[0]!)}>
        pick-me
      </button>
    </div>
  ),
}));
vi.mock('../components/department-panel.js', () => ({
  DepartmentPanel: (props: Record<string, unknown>) => {
    state.dept = props;
    return <div data-testid="dept-panel">{(props.node as DepartmentNode | null)?.name ?? ''}</div>;
  },
}));
vi.mock('../components/positions-panel.js', () => ({
  PositionsPanel: () => <div data-testid="positions-panel" />,
}));
vi.mock('../components/department-dialog.js', () => ({
  DepartmentDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="department-dialog" /> : null,
}));
vi.mock('../components/invite-dialog.js', () => ({
  InviteDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="invite-dialog" /> : null,
}));

beforeEach(() => {
  state.view = undefined;
  state.navigate = vi.fn();
  state.users = users;
  state.tree = {
    data: [node('main', 'Компания', [node('bim', 'BIM-отдел')])],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  state.dept = null;
  state.divisions = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeesPage: вкладки и структура (#768)', () => {
  it('вход в структуру центрирует моё подразделение и открывает панель', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);

    await waitFor(() => expect(screen.getByTestId('dept-panel').textContent).toBe('BIM-отдел'));
    expect(state.dept?.mainCard).toBe(false);
  });

  it('карта статистики карточек считается на странице и передаётся в дерево', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);

    await waitFor(() => expect(screen.getByTestId('divisions-view')).toBeTruthy());
    const stats = state.divisions?.statsById as Map<string, { subordinates: UserListItem[] }>;
    expect(stats.has('main')).toBe(true);
    expect(stats.get('bim')?.subordinates.map((user) => user.id)).toEqual(['me']);
  });

  it('без членства панель показывает главную карточку компании', async () => {
    state.view = 'structure';
    state.users = [person('me', 'Маторин Артём')];
    render(<EmployeesPage />);

    await waitFor(() => expect(screen.getByTestId('dept-panel').textContent).toBe('Компания'));
    expect(state.dept?.mainCard).toBe(true);
  });

  it('поиск: выбор подразделения и сотрудника переключает панель и подсветку', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);
    await waitFor(() => expect(screen.getByTestId('dept-panel').textContent).toBe('BIM-отдел'));

    fireEvent.click(screen.getByText('pick-dept'));
    expect(screen.getByTestId('dept-panel').textContent).toBe('BIM-отдел');

    fireEvent.click(screen.getByText('pick-me'));
    await waitFor(() => expect(state.dept?.highlightUserId).toBe('me'));
  });

  it('«Найти меня»: моё подразделение, панель и подсветка моей строки', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);
    await waitFor(() => expect(state.divisions).toBeTruthy());
    expect(state.divisions?.myDepartmentId).toBe('bim');

    (state.divisions?.onLocateMe as () => void)();
    await waitFor(() => expect(state.dept?.highlightUserId).toBe('me'));
    expect(state.divisions?.selectedId).toBe('bim');
  });

  it('без отдела бейдж «Ваш отдел» — на главной карточке компании (видят все)', async () => {
    state.view = 'structure';
    state.users = [person('me', 'Маторин Артём')];
    render(<EmployeesPage />);

    await waitFor(() => expect(state.divisions).toBeTruthy());
    // myDepartmentId = своё активное подразделение, иначе главная карточка.
    expect(state.divisions?.myDepartmentId).toBe('main');
  });

  it('«⋯» карточки открывает правку отдела', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);
    await waitFor(() => expect(state.divisions).toBeTruthy());
    (state.divisions?.onEdit as (node: unknown) => void)({ id: 'bim', name: 'BIM-отдел' });
    await waitFor(() => expect(screen.getByTestId('department-dialog')).toBeTruthy());
  });

  it('клик по карточке не закрывает постоянную панель', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);
    await waitFor(() => expect(screen.getByTestId('dept-panel')).toBeTruthy());

    fireEvent.click(screen.getByText('select-main'));
    expect(screen.getByTestId('dept-panel').textContent).toBe('Компания');
    fireEvent.click(screen.getByText('select-main'));
    expect(screen.getByTestId('dept-panel').textContent).toBe('Компания');
  });

  it('«Должности» подменяют содержимое панели, повторное нажатие возвращает сотрудников', async () => {
    state.view = 'structure';
    render(<EmployeesPage />);
    await waitFor(() => expect(screen.getByTestId('dept-panel')).toBeTruthy());

    fireEvent.click(screen.getByText('positions'));
    expect(screen.getByTestId('positions-panel')).toBeTruthy();
    expect(screen.queryByTestId('dept-panel')).toBeNull();

    fireEvent.click(screen.getByText('positions'));
    expect(screen.getByTestId('dept-panel')).toBeTruthy();
    expect(screen.queryByTestId('positions-panel')).toBeNull();

    fireEvent.click(screen.getByText('invite'));
    expect(screen.getByTestId('invite-dialog')).toBeTruthy();
  });

  it('список — дефолт: таблица и «Пригласить» админу', () => {
    render(<EmployeesPage />);
    expect(screen.getByTestId('data-table')).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.employees.invite })).toBeTruthy();
  });

  it('старые URL нормализуются заменой с сохранением cards', async () => {
    state.view = 'divisions';
    render(<EmployeesPage />);
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    const call = state.navigate.mock.calls[0]![0] as {
      to: string;
      replace: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe('/employees');
    expect(call.replace).toBe(true);
    expect(call.search({ view: 'divisions', cards: 'employee:1' })).toEqual({
      view: 'structure',
      cards: 'employee:1',
    });
  });

  it('неизвестный view → список с удалением параметра', async () => {
    state.view = 'what';
    render(<EmployeesPage />);
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    const call = state.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ view: 'what', cards: 'x' })).toEqual({ cards: 'x' });
  });

  it('пустая структура — подсказка создания подразделения, панели нет', () => {
    state.view = 'structure';
    state.tree.data = [];
    render(<EmployeesPage />);
    expect(screen.getByText(ui.employees.noDepartments)).toBeTruthy();
    expect(screen.queryByTestId('dept-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.createDepartment }));
    expect(screen.getByTestId('department-dialog')).toBeTruthy();
  });

  it('ошибка загрузки дерева — сообщение и «Повторить»', () => {
    state.view = 'structure';
    state.tree.data = undefined as never;
    state.tree.isError = true;
    render(<EmployeesPage />);
    expect(screen.getByText(ui.employees.departmentsLoadError)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.loadErrorRetry }));
    expect(state.tree.refetch).toHaveBeenCalled();
  });
});
