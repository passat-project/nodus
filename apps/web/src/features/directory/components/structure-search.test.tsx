// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { StructureSearch } from './structure-search.js';

/** Поиск по структуре (#768): подразделения и активные сотрудники, выбор
 *  очищает запрос; на узкой шапке поле живёт в поповере-иконке. */

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
  memberCount: 0,
  children,
});

const person = (id: string, displayName: string, overrides: Partial<UserListItem> = {}) => ({
  id,
  displayName,
  status: 'active' as const,
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

const roots = [node('main', 'ПассатПроект', [node('bim', 'BIM-отдел')])];
const users = [
  person('anna', 'Ночная Анна', { positionName: 'BIM-менеджер' }),
  person('dismissed', 'Уволенный Сотрудник', { status: 'deactivated' }),
];

afterEach(() => {
  cleanup();
});

describe('StructureSearch (#768)', () => {
  it('находит подразделение и сотрудника, выбор отдаёт id/сотрудника и очищает запрос', () => {
    const onPickDepartment = vi.fn();
    const onPickEmployee = vi.fn();
    render(
      <StructureSearch
        roots={roots}
        users={users}
        onPickDepartment={onPickDepartment}
        onPickEmployee={onPickEmployee}
      />,
    );
    const input = screen.getByPlaceholderText(ui.employees.structureSearch) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'BIM' } });
    fireEvent.click(screen.getByRole('button', { name: 'BIM-отдел' }));
    expect(onPickDepartment).toHaveBeenCalledWith('bim');
    expect(input.value).toBe('');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Анна' } });
    fireEvent.click(screen.getByRole('button', { name: /Ночная Анна/ }));
    expect(onPickEmployee).toHaveBeenCalledWith(expect.objectContaining({ id: 'anna' }));
  });

  it('пустое поле не открывает выпадашку (никакого мелькающего окна)', () => {
    render(
      <StructureSearch
        roots={roots}
        users={users}
        onPickDepartment={vi.fn()}
        onPickEmployee={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(ui.employees.structureSearch);
    fireEvent.focus(input);
    fireEvent.click(input);
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(screen.queryByText(ui.filters.notFound)).toBeNull();
  });

  it('уволенные в поиск не попадают; пустой результат — подпись в выпадашке', () => {
    render(
      <StructureSearch
        roots={roots}
        users={users}
        onPickDepartment={vi.fn()}
        onPickEmployee={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(ui.employees.structureSearch);
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'Уволенный' } });
    expect(screen.getByText(ui.filters.notFound)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'нет такого' } });
    expect(screen.getByText(ui.filters.notFound)).toBeTruthy();
  });

  it('Enter выбирает первый результат', () => {
    const onPickDepartment = vi.fn();
    render(
      <StructureSearch
        roots={roots}
        users={users}
        onPickDepartment={onPickDepartment}
        onPickEmployee={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(ui.employees.structureSearch);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'BIM' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPickDepartment).toHaveBeenCalledWith('bim');
  });

  it('узкая шапка: поиск раскрывается иконкой в поповер', () => {
    render(
      <StructureSearch
        compact
        roots={roots}
        users={users}
        onPickDepartment={vi.fn()}
        onPickEmployee={vi.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText(ui.employees.structureSearch)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.employees.structureSearch }));
    const input = screen.getByPlaceholderText(ui.employees.structureSearch);
    fireEvent.change(input, { target: { value: 'BIM' } });
    expect(screen.getByRole('button', { name: 'BIM-отдел' })).toBeTruthy();
  });
});
