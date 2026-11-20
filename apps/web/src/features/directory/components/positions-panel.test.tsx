// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { UserListItem } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../../../shared/api-client.js';
import { PositionsPanel } from './positions-panel.js';

/**
 * Панель «Должности» (#768): только управленческие, поиск по названию,
 * создание в диалоге с проверкой дублей, число сотрудников (включая
 * уволенных), переименование/удаление в «шашке» меню, переназначение перед
 * удалением.
 */

const mocks = vi.hoisted(() => ({
  positions: [
    {
      id: 'p-1',
      name: 'BIM-мастер',
      kind: 'management' as const,
      sortOrder: 0,
    },
    {
      id: 'p-2',
      name: 'BIM-менеджер',
      kind: 'management' as const,
      sortOrder: 1,
    },
    {
      id: 'p-3',
      name: 'Инженер',
      kind: 'management' as const,
      sortOrder: 2,
    },
  ] as import('@nodus/contracts').Position[],
  createMutate: vi.fn(),
  createAsync: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  reassignMutate: vi.fn(),
}));

vi.mock('../../../shared/api/positions.js', () => ({
  usePositions: () => ({ data: mocks.positions }),
}));
vi.mock('../api/directory-api.js', () => ({
  useCreatePosition: () => ({
    mutate: mocks.createMutate,
    mutateAsync: mocks.createAsync,
    isPending: false,
  }),
  useUpdatePosition: () => ({ mutate: mocks.updateMutate, isPending: false }),
  useDeletePosition: () => ({ mutate: mocks.deleteMutate, isPending: false }),
  useReassignPosition: () => ({ mutate: mocks.reassignMutate, isPending: false }),
}));

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

const users = [
  person('holder-1', 'active', { positionId: 'p-2' }),
  person('holder-2', 'active', { positionId: 'p-2' }),
  person('holder-3', 'active', { positionId: 'p-2' }),
  person('dismissed', 'deactivated', { positionId: 'p-2' }),
];

const mount = (canManage = true) => (
  <PositionsPanel users={users} topShift={0} canManage={canManage} onClose={vi.fn()} />
);

function press(element: HTMLElement) {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' });
  fireEvent.click(element);
}

/** Radix-меню в jsdom: pointerdown + click (см. fields-tab.row-menu). */
async function openMenuIn(row: HTMLElement) {
  press(within(row).getByRole('button', { name: ui.common.rowMenu }));
  await screen.findByRole('menuitem', { name: ui.employees.renamePosition });
}

async function openRowMenu(name: string) {
  await openMenuIn(screen.getByText(name).closest('li')!);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.positions = [
    { id: 'p-1', name: 'BIM-мастер', kind: 'management', sortOrder: 0 },
    { id: 'p-2', name: 'BIM-менеджер', kind: 'management', sortOrder: 1 },
    { id: 'p-3', name: 'Инженер', kind: 'management', sortOrder: 2 },
  ];
});

describe('PositionsPanel (#768)', () => {
  it('читателю — список с числом сотрудников, без действий', () => {
    render(mount(false));
    expect(screen.getByRole('heading', { name: ui.employees.positionsList })).toBeTruthy();
    expect(screen.getByText('BIM-мастер')).toBeTruthy();
    // 0 сотрудников видно (две свободные должности: BIM-мастер и Инженер).
    expect(screen.getAllByText(`${ui.employees.positionHolders}: 0`)).toHaveLength(2);
    // Уволенные считаются: отдельного архива должностей у них нет.
    expect(screen.getByText(`${ui.employees.positionHolders}: 4`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.employees.positionAdd })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.common.rowMenu })).toBeNull();
  });

  it('крестик возвращает к панели подразделения', () => {
    const onClose = vi.fn();
    render(<PositionsPanel users={users} topShift={0} canManage onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalled();
  });

  it('поиск фильтрует список по названию', () => {
    render(mount());
    fireEvent.change(screen.getByPlaceholderText(ui.employees.positionSearch), {
      target: { value: 'мастер' },
    });
    expect(screen.getByText('BIM-мастер')).toBeTruthy();
    expect(screen.queryByText('BIM-менеджер')).toBeNull();
  });

  it('создание — в диалоге кнопки «Добавить», дубль не отправляется', async () => {
    mocks.createAsync.mockResolvedValue({});
    render(mount());
    const add = screen.getByRole('button', { name: ui.employees.positionAdd });
    // Без акцентной заливки: акцент в модуле — у «Пригласить».
    expect(add.dataset.variant).toBe('ghost');
    fireEvent.click(add);

    const input = screen.getByPlaceholderText(ui.employees.positionNamePlaceholder);
    fireEvent.change(input, { target: { value: '  bim-МАСТЕР ' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(screen.getByText(ui.employees.positionExists)).toBeTruthy();
    expect(mocks.createAsync).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Новая должность' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(mocks.createAsync).toHaveBeenCalledWith({
      name: 'Новая должность',
      kind: 'management',
      sortOrder: 0,
    });
  });

  it('серверный дубль показывается в диалоге, а не системным тостом', async () => {
    mocks.createAsync.mockRejectedValue(
      new ApiError(ErrorCode.DIRECTORY_POSITION_EXISTS, 'exists', 409, { positionId: 'p-1' }),
    );
    render(mount());
    fireEvent.click(screen.getByRole('button', { name: ui.employees.positionAdd }));
    fireEvent.change(screen.getByPlaceholderText(ui.employees.positionNamePlaceholder), {
      target: { value: 'Свежая должность' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(await screen.findByText(ui.employees.positionExists)).toBeTruthy();
  });

  it('переименование — через меню строки, уходит только имя', async () => {
    mocks.updateMutate.mockImplementation((_args: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    render(mount());
    const row = screen.getByText('BIM-мастер').closest('li')!;
    await openMenuIn(row as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.renamePosition }));

    const input = row.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'BIM-ведущий' } });
    fireEvent.click(row.querySelector('button[aria-label="Сохранить"]')!);

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { id: 'p-1', patch: { name: 'BIM-ведущий' } },
      expect.any(Object),
    );
  });

  it('удаление без сотрудников — сразу; с сотрудниками — переназначение', async () => {
    render(mount());
    await openRowMenu('BIM-мастер');
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.positionDelete }));
    expect(mocks.deleteMutate).toHaveBeenCalledWith('p-1', expect.any(Object));

    await openRowMenu('BIM-менеджер');
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.positionDelete }));
    expect(mocks.deleteMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: ui.employees.positionReassignTitle })).toBeTruthy();
    expect(screen.getByText(`${ui.employees.positionReassignCount}: 4`)).toBeTruthy();
  });

  it('выбор цели: ввод фильтрует, Enter переводит на первую', async () => {
    render(mount());
    await openRowMenu('BIM-менеджер');
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.positionDelete }));

    const field = screen.getByPlaceholderText(ui.employees.positionReassignSearch);
    fireEvent.change(field, { target: { value: 'инж' } });
    expect(screen.getByRole('option', { name: /Инженер/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /BIM-мастер/ })).toBeNull();

    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: ui.employees.positionReassignAction }));
    expect(mocks.reassignMutate).toHaveBeenCalledWith(
      { id: 'p-2', targetId: 'p-3' },
      expect.any(Object),
    );
  });

  it('список цели не открывается фокусом — только клик/ввод/ArrowDown', async () => {
    render(mount());
    await openRowMenu('BIM-менеджер');
    fireEvent.click(screen.getByRole('menuitem', { name: ui.employees.positionDelete }));

    const field = screen.getByPlaceholderText(ui.employees.positionReassignSearch);
    fireEvent.focus(field);
    expect(screen.queryByRole('option', { name: /Инженер/ })).toBeNull();

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Инженер/ })).toBeTruthy();
  });

  it('пустой справочник — подпись «Должностей пока нет»', () => {
    mocks.positions = [];
    render(mount());
    expect(screen.getByText(ui.employees.noPositions)).toBeTruthy();
  });
});
