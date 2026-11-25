import type { DepartmentNode, UserListItem } from '@nodus/contracts';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';
import { findDepartment } from '../lib/department-tree.js';
import { DeleteDepartmentDialog } from './delete-department-dialog.js';
import { MoveEmployeeDialog } from './move-employee-dialog.js';

/**
 * Оверлеи действий с подразделением (#881): один экземпляр на страницу для
 * меню карточки и панели. Страница держит выбранный узел и реакцию на успех
 * (выбрать родителя / подсветить переведённого), здесь — только композиция.
 */
export function DepartmentActionDialogs({
  transferNode,
  deleteNode,
  roots,
  users,
  departmentOptions,
  onTransferOpenChange,
  onDeleteOpenChange,
  onMoved,
  onDeleted,
}: {
  transferNode: DepartmentNode | null;
  deleteNode: DepartmentNode | null;
  roots: readonly DepartmentNode[];
  users: readonly UserListItem[];
  departmentOptions: readonly DepartmentOption[];
  onTransferOpenChange: (open: boolean) => void;
  onDeleteOpenChange: (open: boolean) => void;
  onMoved: (node: DepartmentNode, userId: string) => void;
  onDeleted: (parentId: string) => void;
}) {
  return (
    <>
      {transferNode ? (
        <MoveEmployeeDialog
          open
          onOpenChange={onTransferOpenChange}
          department={transferNode}
          users={users}
          departmentOptions={departmentOptions}
          onMoved={(userId) => onMoved(transferNode, userId)}
        />
      ) : null}
      {deleteNode?.parentId ? (
        <DeleteDepartmentDialog
          open
          onOpenChange={onDeleteOpenChange}
          department={deleteNode}
          parentName={findDepartment([...roots], deleteNode.parentId)?.name ?? ''}
          users={users}
          onDeleted={onDeleted}
        />
      ) : null}
    </>
  );
}
