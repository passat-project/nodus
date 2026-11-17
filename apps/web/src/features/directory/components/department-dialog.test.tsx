// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DepartmentDialog } from './department-dialog.js';

/**
 * Окно отдела (#768, пакет 17.11.2026): Radix ставит фокус в первое поле и
 * ВЫДЕЛЯЕТ текст — фокус ставим сами, в конец без выделения. Комбобоксы
 * открываются кликом/вводом/ArrowDown, а не фокусом: иначе окно «мигало»
 * списком сразу после открытия, а Esc закрывал окно вместо списка.
 */

vi.mock('../api/directory-api.js', () => ({
  useCreateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const person = (id: string, displayName: string, status: UserListItem['status']): UserListItem => ({
  id,
  displayName,
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

const editing: DepartmentNode = {
  id: 'dep-1',
  name: 'Проектный отдел',
  kind: 'management',
  parentId: null,
  headId: null,
  deputyId: null,
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputyName: null,
  memberCount: 0,
  children: [],
};

const users = [person('u-1', 'Иванов Иван', 'active'), person('u-2', 'Петров Пётр', 'active')];

function dialog(open: boolean, editingNode: DepartmentNode | null = editing) {
  return (
    <DepartmentDialog
      open={open}
      onOpenChange={vi.fn()}
      kind="management"
      parentId={null}
      editing={editingNode}
      users={users}
      departmentOptions={[{ id: 'dep-1', name: 'Проектный отдел', depth: 0, isActive: true }]}
    />
  );
}

/** Окно открывается из закрытого состояния — как на странице: черновик
 *  наполняется на открытии (`prevOpen`), затем Radix ставит фокус. */
async function mount(editingNode: DepartmentNode | null = editing) {
  const view = render(dialog(false, editingNode));
  view.rerender(dialog(true, editingNode));
  await screen.findByRole('dialog');
  return view;
}

afterEach(cleanup);

describe('DepartmentDialog: фокус и списки (#768)', () => {
  it('фокус в названии — каретка в конце, без выделения', async () => {
    await mount();
    const input = screen.getByLabelText(ui.employees.fieldDepartmentName) as HTMLInputElement;

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe('Проектный отдел'.length);
    expect(input.selectionEnd).toBe('Проектный отдел'.length);
  });

  it('авто-выделение Radix снимается: после select() каретка уходит в конец', async () => {
    await mount();
    const input = screen.getByLabelText(ui.employees.fieldDepartmentName) as HTMLInputElement;

    // FocusScope возвращает фокус в поле вместе с `element.select()` (уход
    // фокуса из окна при закрытии меню): выделение не должно доживать до ввода.
    input.select();
    fireEvent.focus(input);

    await waitFor(() => {
      expect(input.selectionStart).toBe(input.value.length);
      expect(input.selectionEnd).toBe(input.value.length);
    });
  });

  it('программный фокус в поле руководителя НЕ открывает список', async () => {
    await mount();
    const head = screen.getByLabelText(ui.employees.fieldHead);

    fireEvent.focus(head);

    // Список сотрудников не появился: открытие — клик/ввод/ArrowDown.
    expect(screen.queryByRole('button', { name: /Иванов Иван/ })).toBeNull();
  });

  it('клик открывает список и он остаётся; ввод фильтрует; Esc закрывает список', async () => {
    await mount();
    const head = screen.getByLabelText(ui.employees.fieldHead);

    fireEvent.click(head);
    expect(screen.getByRole('button', { name: /Иванов Иван/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Петров Пётр/ })).toBeTruthy();

    fireEvent.change(head, { target: { value: 'петр' } });
    expect(screen.getByRole('button', { name: /Петров Пётр/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Иванов Иван/ })).toBeNull();

    fireEvent.keyDown(head, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Петров Пётр/ })).toBeNull();
    // Esc закрыл список, а не окно: заголовок на месте.
    expect(screen.getByText(ui.employees.editDepartmentTitle)).toBeTruthy();
  });

  it('ArrowDown открывает список без мыши', async () => {
    await mount();
    const head = screen.getByLabelText(ui.employees.fieldHead);

    fireEvent.keyDown(head, { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: /Иванов Иван/ })).toBeTruthy();
  });
});
