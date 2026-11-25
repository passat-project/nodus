import { useEffect, useState } from 'react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';
import { useTransferEmployee } from '../api/department-actions-api.js';
import { EmployeeCombobox } from './employee-combobox.js';

/**
 * Перевод сотрудника в подразделение из меню «⋯» (#881): пикер активных
 * сотрудников ИЗ ДРУГИХ подразделений. Целевой отдел задан карточкой/панелью;
 * после успеха человек сразу виден в «Подчинённых» целевого узла.
 */
export function MoveEmployeeDialog({
  open,
  onOpenChange,
  department,
  users,
  departmentOptions,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: DepartmentNode;
  users: readonly UserListItem[];
  departmentOptions: readonly DepartmentOption[];
  /** Успешный перевод: страница выбирает целевой узел и подсвечивает строку. */
  onMoved: (userId: string) => void;
}) {
  const transfer = useTransferEmployee();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setUserId(null);
  }, [open, department.id]);

  const candidates = users.filter(
    (user) => user.status === 'active' && user.departmentId !== department.id,
  );
  const selected = candidates.find((user) => user.id === userId) ?? null;
  const currentDepartment = selected?.departmentId
    ? (departmentOptions.find((option) => option.id === selected.departmentId)?.name ?? null)
    : null;
  // #946: перевод снимает руководящую роль старого узла — предупреждаем до
  // сохранения, иначе отдел останется без главы/зама неожиданно.
  const leaderElsewhere =
    selected !== null &&
    departmentOptions.some(
      (option) =>
        option.id !== department.id &&
        (option.headId === selected.id || option.deputyIds.includes(selected.id)),
    );

  function submit() {
    if (!userId || transfer.isPending) return;
    transfer.mutate(
      { userId, departmentId: department.id },
      {
        onSuccess: () => {
          onOpenChange(false);
          onMoved(userId);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full bg-card sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.transferEmployeeTitle}
        </DialogTitle>
        <p className="-mt-1 text-sm text-muted-foreground">{ui.employees.transferEmployeeLead}</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {ui.employees.fieldEmployee}
          </span>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.employees.transferEmployeeEmpty}</p>
          ) : (
            <EmployeeCombobox
              value={userId}
              onChange={setUserId}
              ariaLabel={ui.employees.transferEmployeeSearch}
              placeholder={ui.employees.transferEmployeeSearch}
              users={candidates}
            />
          )}
          {selected ? (
            <p className="text-xs text-muted-foreground">
              {ui.employees.transferEmployeeCurrent}:{' '}
              {currentDepartment ?? ui.employees.transferEmployeeNoDepartment}
            </p>
          ) : null}
          {leaderElsewhere ? (
            <p className="text-xs text-muted-foreground">
              {ui.employees.transferEmployeeLeaderHint}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!userId || transfer.isPending} onClick={submit}>
            {ui.employees.transferEmployeeSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
