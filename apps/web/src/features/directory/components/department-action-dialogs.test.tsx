// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode } from '@nodus/contracts';

import { DepartmentActionDialogs } from './department-action-dialogs.js';

/** #881: оверлеи страницы передают успех перевода/удаления в навигацию. */

vi.mock('./move-employee-dialog.js', () => ({
  MoveEmployeeDialog: ({
    department,
    onMoved,
  }: {
    department: DepartmentNode;
    onMoved: (userId: string) => void;
  }) => <button onClick={() => onMoved('u1')}>move-{department.id}</button>,
}));
vi.mock('./delete-department-dialog.js', () => ({
  DeleteDepartmentDialog: ({
    department,
    onDeleted,
  }: {
    department: DepartmentNode;
    onDeleted: (parentId: string) => void;
  }) => <button onClick={() => onDeleted(department.parentId!)}>delete-{department.id}</button>,
}));

const node = (id: string, parentId: string | null = null): DepartmentNode => ({
  id,
  name: id,
  kind: 'management',
  parentId,
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 0,
  children: [],
});

afterEach(() => cleanup());

describe('DepartmentActionDialogs (#881)', () => {
  it('перевод отдаёт узел и сотрудника, удаление — родителя', () => {
    const onMoved = vi.fn();
    const onDeleted = vi.fn();
    render(
      <DepartmentActionDialogs
        transferNode={node('bim', 'main')}
        deleteNode={node('lab', 'bim')}
        roots={[node('main')]}
        users={[]}
        departmentOptions={[]}
        onTransferOpenChange={vi.fn()}
        onDeleteOpenChange={vi.fn()}
        onMoved={onMoved}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'move-bim' }));
    expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ id: 'bim' }), 'u1');

    fireEvent.click(screen.getByRole('button', { name: 'delete-lab' }));
    expect(onDeleted).toHaveBeenCalledWith('bim');
  });
});
