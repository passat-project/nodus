import { ui } from '@nodus/contracts';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useUsersList } from '../../../shared/api/users-list.js';
import { usePositions } from '../api/directory-api.js';
import { computeDataCheck, type DataCheckEntry } from '../lib/data-check.js';

function Section({ label, entries }: { label: string; entries: DataCheckEntry[] }) {
  return (
    <section className="flex min-h-0 flex-col gap-1.5">
      <NodeLabel label={label} count={entries.length} />
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ui.employees.dataCheckEmpty}</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
          {entries.map((entry) => (
            <li key={entry.id} className="truncate px-2.5 py-1.5 text-sm">
              {entry.name}
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
 * без подразделения. Расчёт — чистая `computeDataCheck` из полных списков
 * (`fetchAllUsers` пагинирует все страницы; штат ~170).
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
  const report = computeDataCheck(data?.items ?? [], [...management, ...legal]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-md bg-card">
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.dataCheckTitle}
        </DialogTitle>
        <div className="flex flex-col gap-4">
          <Section
            label={ui.employees.dataCheckPositions}
            entries={report.positionsWithoutEmployees}
          />
          <Section label={ui.employees.dataCheckNoManager} entries={report.withoutManager} />
          <Section label={ui.employees.dataCheckNoDepartment} entries={report.withoutDepartment} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
