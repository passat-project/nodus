import { ui } from '@nodus/contracts';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useUsersList } from '../../../shared/api/users-list.js';
import { usePositions } from '../api/directory-api.js';

function Section({ label, names }: { label: string; names: string[] }) {
  return (
    <section className="flex min-h-0 flex-col gap-1.5">
      <NodeLabel label={label} count={names.length} />
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ui.employees.dataCheckEmpty}</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
          {names.map((name) => (
            <li key={name} className="truncate px-2.5 py-1.5 text-sm">
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Отчёт проверки данных оргструктуры (#441, право `directory.manage`):
 * должности без сотрудников (обе структуры), сотрудники без руководителя и
 * без подразделения. Клиентский расчёт из полных списков (`fetchAllUsers`
 * пагинирует все страницы; штат ~170) — отдельный эндпоинт не нужен.
 */
export function DataCheckDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useUsersList();
  const management = usePositions('management').data ?? [];
  const legal = usePositions('legal').data ?? [];
  const users = (data?.items ?? []).filter((user) => user.status === 'active');

  const positionsWithoutEmployees = [...management, ...legal]
    .filter(
      (position) =>
        !users.some(
          (user) => user.positionId === position.id || user.legalPositionId === position.id,
        ),
    )
    .map((position) => position.name);
  const withoutManager = users.filter((user) => !user.managerId).map((user) => user.displayName);
  const withoutDepartment = users
    .filter((user) => !user.departmentId)
    .map((user) => user.displayName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-md bg-card">
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.dataCheckTitle}
        </DialogTitle>
        <div className="flex flex-col gap-4">
          <Section label={ui.employees.dataCheckPositions} names={positionsWithoutEmployees} />
          <Section label={ui.employees.dataCheckNoManager} names={withoutManager} />
          <Section label={ui.employees.dataCheckNoDepartment} names={withoutDepartment} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
