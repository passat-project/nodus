import { Check, ChevronRight } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useUsersList } from '../../../shared/api/users-list.js';
import { usePositions } from '../api/directory-api.js';
import { computeDataCheck, type DataCheckEntry } from '../lib/data-check.js';

function Section({
  label,
  entries,
  onOpen,
}: {
  label: string;
  entries: DataCheckEntry[];
  /** Секции сотрудников: строка открывает карточку (диагностика → правка). */
  onOpen?: (id: string, source: DOMRect) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col gap-1.5">
      <NodeLabel label={label} count={entries.length} />
      {entries.length === 0 ? (
        <p className="flex items-center gap-1.5 px-1 text-sm text-success">
          <Check className="size-3.5" strokeWidth={2} />
          {ui.employees.dataCheckEmpty}
        </p>
      ) : (
        <ul className="max-h-40 overflow-y-auto rounded-lg border border-border">
          {entries.map((entry) =>
            onOpen ? (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={(event) => onOpen(entry.id, event.currentTarget.getBoundingClientRect())}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring/30"
                >
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ) : (
              <li key={entry.id} className="truncate px-3 py-2 text-sm">
                {entry.name}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * Отчёт проверки данных оргструктуры (#441, право `directory.manage`):
 * должности без сотрудников (обе структуры), сотрудники без руководителя и
 * без подразделения. Расчёт — чистая `computeDataCheck` из полных списков
 * (`fetchAllUsers` пагинирует все страницы; штат ~170). Строки сотрудников
 * открывают карточку — отчёт ведёт к правке, а не только констатирует.
 */
export function DataCheckDialog({
  open,
  onOpenChange,
  onOpenEmployee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenEmployee: (id: string, source: DOMRect) => void;
}) {
  const { data } = useUsersList();
  const management = usePositions('management').data ?? [];
  const legal = usePositions('legal').data ?? [];
  const report = computeDataCheck(data?.items ?? [], [...management, ...legal]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full bg-card sm:max-w-md"
        // Отчёт, а не форма: при открытии не подсвечиваем первую строку —
        // фокус на самом окне, Tab ведёт по строкам (иначе синяя рамка первой
        // строки читается как выбор).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.target as HTMLElement | null)?.focus();
        }}
      >
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.dataCheckTitle}
        </DialogTitle>
        <div className="flex flex-col gap-4">
          <Section
            label={ui.employees.dataCheckPositions}
            entries={report.positionsWithoutEmployees}
          />
          <Section
            label={ui.employees.dataCheckNoManager}
            entries={report.withoutManager}
            onOpen={onOpenEmployee}
          />
          <Section
            label={ui.employees.dataCheckNoDepartment}
            entries={report.withoutDepartment}
            onOpen={onOpenEmployee}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
