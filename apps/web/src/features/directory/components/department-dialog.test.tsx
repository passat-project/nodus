// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DepartmentDialog } from './department-dialog.js';

/**
 * Форма подразделения (#817): заместители — МНОЖЕСТВЕННЫЙ выбор чипами;
 * PATCH уходит с ПОЛНЫМ массивом `deputyIds` (порядок = sortOrder связи), а
 * неизменённый набор не отправляется вовсе (частичная правка #492).
 */

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';
const DEPUTY_A = '22222222-2222-4222-8222-222222222222';
const DEPUTY_B = '33333333-3333-4333-8333-333333333333';
const DISMISSED_ID = '44444444-4444-4444-8444-444444444444';

const spies = vi.hoisted(() => ({ createMutate: vi.fn(), updateMutate: vi.fn() }));

vi.mock('../api/directory-api.js', () => ({
  useCreateDepartment: () => ({ mutate: spies.createMutate, isPending: false }),
  useUpdateDepartment: () => ({ mutate: spies.updateMutate, isPending: false }),
}));

const people: UserListItem[] = [
  {
    id: DEPUTY_A,
    displayName: 'Зам Один',
    status: 'active',
    avatarUrl: null,
    positionName: 'Инженер',
    departmentName: null,
    email: 'a@test.local',
    managerId: null,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
  },
  {
    id: DEPUTY_B,
    displayName: 'Зам Два',
    status: 'active',
    avatarUrl: null,
    positionName: 'Инженер',
    departmentName: null,
    email: 'b@test.local',
    managerId: null,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
  },
  {
    id: DISMISSED_ID,
    displayName: 'Уволенный Зам',
    status: 'deactivated',
    avatarUrl: null,
    positionName: 'Инженер',
    departmentName: null,
    email: 'old@test.local',
    managerId: null,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
  },
];

// Пикер ищет сотрудников серверно (useUsersSearch) — API отдаёт только активных.
vi.mock('../../../shared/api/users-list.js', () => ({
  useUsersSearch: () => ({
    data: { items: people.filter((person) => person.status === 'active') },
    isFetching: false,
  }),
}));

const node: DepartmentNode = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: null,
  deputyIds: [DEPUTY_A],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [{ id: DEPUTY_A, displayName: 'Зам Один' }],
  memberCount: 0,
  children: [],
};

function renderDialog(editing: DepartmentNode | null) {
  return render(
    <DepartmentDialog
      open
      onOpenChange={vi.fn()}
      kind="management"
      parentId={null}
      editing={editing}
      users={people}
      departmentOptions={[]}
    />,
  );
}

/** Триггер пикера замков: «Добавить: Заместители». */
function openPicker() {
  fireEvent.click(
    screen.getByRole('button', { name: `${ui.common.add}: ${ui.employees.fieldDeputies}` }),
  );
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: ui.common.save }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DepartmentDialog: заместители (#817)', () => {
  it('правка показывает ВСЕХ текущих заместителей чипами', () => {
    renderDialog({
      ...node,
      deputyIds: [DEPUTY_A, DEPUTY_B],
      deputies: [
        { id: DEPUTY_A, displayName: 'Зам Один' },
        { id: DEPUTY_B, displayName: 'Зам Два' },
      ],
    });

    expect(screen.getByText('Зам Один')).toBeTruthy();
    expect(screen.getByText('Зам Два')).toBeTruthy();
  });

  it('добавление второго заместителя: PATCH везёт полный массив', () => {
    renderDialog(node);

    openPicker();
    fireEvent.click(screen.getByText('Зам Два'));
    save();

    expect(spies.updateMutate).toHaveBeenCalledTimes(1);
    expect(spies.updateMutate.mock.calls[0]?.[0]).toEqual({
      id: DEPARTMENT_ID,
      patch: { deputyIds: [DEPUTY_A, DEPUTY_B] },
    });
  });

  it('снятие чипа: PATCH очищает набор (пустой массив снимает всех)', () => {
    renderDialog(node);

    fireEvent.click(screen.getByRole('button', { name: `${ui.common.remove}: Зам Один` }));
    save();

    expect(spies.updateMutate.mock.calls[0]?.[0]).toEqual({
      id: DEPARTMENT_ID,
      patch: { deputyIds: [] },
    });
  });

  it('уволенный заместитель не приезжает в набор при открытии и не возвращается при сохранении', () => {
    // Узел от API: в deputyIds только действующий — уволенный отфильтрован.
    // В справочнике уволенный сотрудник ещё есть (журнал), но в наборе его нет.
    renderDialog(node);

    expect(screen.queryByText('Уволенный Зам')).toBeNull();
    expect(screen.queryByRole('button', { name: `${ui.common.remove}: Уволенный Зам` })).toBeNull();

    // Правка другого поля не возвращает уволенного в массив.
    fireEvent.change(screen.getByLabelText(ui.employees.fieldDepartmentName), {
      target: { value: 'BIM-отдел новый' },
    });
    fireEvent.click(screen.getByRole('button', { name: `${ui.common.remove}: Зам Один` }));
    save();

    expect(spies.updateMutate.mock.calls[0]?.[0]).toEqual({
      id: DEPARTMENT_ID,
      patch: { deputyIds: [], name: 'BIM-отдел новый' },
    });
  });

  it('неизменённый набор не отправляется (частичная правка #492)', () => {
    renderDialog(node);

    fireEvent.change(screen.getByLabelText(ui.employees.fieldDepartmentName), {
      target: { value: 'BIM-отдел новый' },
    });
    save();

    expect(spies.updateMutate.mock.calls[0]?.[0]).toEqual({
      id: DEPARTMENT_ID,
      patch: { name: 'BIM-отдел новый' },
    });
  });

  it('создание: тело несёт выбранных заместителей', () => {
    renderDialog(null);

    fireEvent.change(screen.getByLabelText(ui.employees.fieldDepartmentName), {
      target: { value: 'Новый отдел' },
    });
    openPicker();
    fireEvent.click(screen.getByText('Зам Два'));
    save();

    expect(spies.createMutate).toHaveBeenCalledTimes(1);
    expect(spies.createMutate.mock.calls[0]?.[0]).toMatchObject({
      name: 'Новый отдел',
      kind: 'management',
      deputyIds: [DEPUTY_B],
    });
  });
});
