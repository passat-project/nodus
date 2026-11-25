import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';

import { plural } from '../../../shared/lib/format.js';
import { useDeleteDepartment } from '../api/department-actions-api.js';

/**
 * Подтверждение жёсткого удаления подразделения (#881): числа по активным
 * детям и прямым сотрудникам, пояснение про уволенных. Дети и сотрудники
 * переезжают к родителю; после успеха страница выбирает родительскую карточку.
 */
export function DeleteDepartmentDialog({
  open,
  onOpenChange,
  department,
  parentName,
  users,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: DepartmentNode;
  parentName: string;
  users: readonly UserListItem[];
  onDeleted: (parentId: string) => void;
}) {
  const remove = useDeleteDepartment('management');
  const parentId = department.parentId;
  const childCount = department.children.length;
  const directUsers = users.filter((user) => user.departmentId === department.id);
  const activeCount = directUsers.filter((user) => user.status === 'active').length;
  const dismissedCount = directUsers.length - activeCount;
  const total = childCount + activeCount;

  const childText = `${childCount} ${plural(childCount, ui.employees.departmentForms)}`;
  const userText = `${activeCount} ${plural(activeCount, ui.employees.employeeForms)}`;
  const verb =
    total === 1 ? ui.employees.deleteDepartmentMovesOne : ui.employees.deleteDepartmentMovesMany;
  const moveText =
    childCount > 0 && activeCount > 0
      ? `${childText} и ${userText} ${verb} «${parentName}»`
      : childCount > 0
        ? `${childText} ${verb} «${parentName}»`
        : activeCount > 0
          ? `${userText} ${verb} «${parentName}»`
          : null;

  function submit() {
    if (!parentId || remove.isPending) return;
    remove.mutate(department.id, {
      onSuccess: () => {
        onOpenChange(false);
        onDeleted(parentId);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full bg-card sm:max-w-md"
        showCloseButton={false}
        tabIndex={-1}
        // Фокус — на само окно, а не на первую кнопку: «Отмена» при открытии
        // мышью выглядела нажатой (индиго-кольцо спорило с красным действием).
        // Tab по-прежнему ведёт в «Отмену» и дальше — с честным кольцом фокуса.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.deleteDepartmentTitle}
        </DialogTitle>
        {/* Подтверждение адресное: название удаляемого подразделения — в окне,
            а не только за ним (меню могло открыться с другой карточки). */}
        <p
          className="-mt-1 min-w-0 truncate text-sm font-medium text-foreground"
          title={department.name}
        >
          {department.name}
        </p>
        <div className="-mt-1 flex flex-col gap-2 text-sm text-muted-foreground">
          <p>{ui.employees.deleteDepartmentLead}</p>
          {moveText ? <p className="text-foreground">{moveText}.</p> : null}
          {!moveText ? <p>{ui.employees.deleteDepartmentEmpty}</p> : null}
          {dismissedCount > 0 ? (
            <p className="text-xs">{ui.employees.deleteDepartmentDismissedHint}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button variant="destructive" disabled={!parentId || remove.isPending} onClick={submit}>
            {ui.employees.deleteDepartmentConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
