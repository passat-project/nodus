// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const mutations = vi.hoisted(() => ({
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
}));

vi.mock('../api/directory-api.js', () => ({
  useCreateDepartment: () => mutations.create,
  useUpdateDepartment: () => mutations.update,
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

function dialog(
  open: boolean,
  editingNode: DepartmentNode | null = editing,
  kind: 'management' | 'legal' = 'management',
  parentId: string | null = null,
) {
  return (
    <DepartmentDialog
      open={open}
      onOpenChange={vi.fn()}
      kind={kind}
      parentId={parentId}
      editing={editingNode}
      users={users}
      departmentOptions={[
        {
          id: 'dep-1',
          name: 'Проектный отдел',
          depth: 0,
          isActive: true,
          headId: null,
          deputyId: null,
        },
        {
          id: 'dep-2',
          name: 'Административное',
          depth: 1,
          isActive: true,
          headId: 'u-1',
          deputyId: null,
        },
        {
          id: 'dep-3',
          name: 'BIM-отдел',
          depth: 2,
          isActive: true,
          headId: null,
          deputyId: null,
        },
      ]}
    />
  );
}

/** Окно открывается из закрытого состояния — как на странице: черновик
 *  наполняется на открытии (`prevOpen`), затем Radix ставит фокус. */
async function mount(
  editingNode: DepartmentNode | null = editing,
  kind: 'management' | 'legal' = 'management',
  parentId: string | null = null,
) {
  const view = render(dialog(false, editingNode, kind, parentId));
  view.rerender(dialog(true, editingNode, kind, parentId));
  await screen.findByRole('dialog');
  return view;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DepartmentDialog: фокус и списки (#768)', () => {
  it('фокус в названии — каретка в конце, без выделения', async () => {
    await mount();
    const input = screen.getByLabelText(ui.employees.fieldDepartmentName) as HTMLInputElement;

    // Фокус ставится следующим кадром (rAF): ждём его, а не микрозадачу.
    await waitFor(() => expect(document.activeElement).toBe(input));
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

  it('выбор главы из другого подразделения — подсказка о переводе (#946)', async () => {
    await mount();

    fireEvent.click(screen.getByLabelText(ui.employees.fieldHead));
    fireEvent.click(screen.getByRole('button', { name: /Иванов Иван/ }));

    expect(screen.getByText(ui.employees.leaderTransferHint)).toBeTruthy();
  });

  it('юрструктура формальная: подсказки о переводе нет (#946)', async () => {
    await mount(editing, 'legal');

    fireEvent.click(screen.getByLabelText(ui.employees.fieldHead));
    fireEvent.click(screen.getByRole('button', { name: /Иванов Иван/ }));

    expect(screen.queryByText(ui.employees.leaderTransferHint)).toBeNull();
  });

  it('глава и зам — один сотрудник: сообщение и сохранение заблокировано (#946)', async () => {
    await mount();

    fireEvent.click(screen.getByLabelText(ui.employees.fieldHead));
    fireEvent.click(screen.getByRole('button', { name: /Иванов Иван/ }));
    fireEvent.click(screen.getByLabelText(ui.employees.fieldDeputy));
    fireEvent.click(screen.getByRole('button', { name: /Иванов Иван/ }));

    expect(screen.getByRole('alert').textContent).toBe(ui.employees.leaderSamePerson);
    expect(
      (screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('DepartmentDialog: вышестоящее подразделение (#982)', () => {
  it('у главной карточки поля «Вышестоящее подразделение» нет', async () => {
    await mount({ ...editing, parentId: null });

    expect(screen.queryByLabelText(ui.employees.parentDepartment)).toBeNull();
  });

  it('при создании без родителя поля нет; под карточкой — имя родителя текстом', async () => {
    const view = await mount(null);
    expect(screen.queryByLabelText(ui.employees.parentDepartment)).toBeNull();
    view.unmount();

    const under: DepartmentNode = { ...editing, id: 'dep-2', name: 'Административное' };
    const { unmount } = await mount(null, 'management', under.id);
    expect(screen.getByText('Административное')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: ui.employees.parentDepartment })).toBeNull();
    unmount();
  });

  it('пункта «Нет вышестоящего подразделения» нет; выбор родителя уходит в PATCH', async () => {
    // Обычное подразделение: текущий родитель — «Административное», кандидат —
    // «BIM-отдел». Открепить в корень нельзя — пункта сброса нет вовсе.
    const child: DepartmentNode = { ...editing, parentId: 'dep-2' };
    await mount(child);

    const parent = screen.getByRole('combobox', { name: ui.employees.parentDepartment });
    fireEvent.click(parent);

    expect(screen.queryByText('Нет вышестоящего подразделения')).toBeNull();
    // «Не выбрано» и крестик сброса у обязательного выбора не рисуются.
    expect(screen.queryByText(ui.employees.notSelected)).toBeNull();

    fireEvent.change(parent, { target: { value: 'BIM' } });
    fireEvent.click(screen.getByRole('option', { name: /BIM-отдел/ }));
    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));

    expect(mutations.update.mutate).toHaveBeenCalledWith(
      { id: 'dep-1', patch: { parentId: 'dep-3' } },
      expect.anything(),
    );
  });

  it('Esc закрывает список, а не окно', async () => {
    await mount({ ...editing, parentId: 'dep-2' });
    const parent = screen.getByRole('combobox', { name: ui.employees.parentDepartment });

    fireEvent.click(parent);
    expect(screen.getByRole('option', { name: /BIM-отдел/ })).toBeTruthy();

    fireEvent.keyDown(parent, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: /BIM-отдел/ })).toBeNull();
    expect(screen.getByText(ui.employees.editDepartmentTitle)).toBeTruthy();
  });
});
