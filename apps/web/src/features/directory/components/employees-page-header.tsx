import { UserPlus } from 'lucide-react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import type { DataTableField } from '../../../shared/views/data-table.js';
import type { FilterFieldDef } from '../../../shared/views/list-filters.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { StructureHeader } from './structure-header.js';

/**
 * Шапки двух вкладок «Сотрудников» (#768/#101): «Структура» — общая шапка с
 * поиском и должностями; «Список» — заголовок, инструменты и primary
 * «Пригласить». Вынесено из страницы (I5): страница держит композицию
 * канваса, панелей и диалогов.
 */
export function EmployeesPageHeader({
  structure,
  staffCount,
  rowWidth,
  canManage,
  positionsOpen,
  roots,
  users,
  toolbar,
  filterDefs,
  defs,
  onInvite,
  onTogglePositions,
  onPickDepartment,
  onPickEmployee,
}: {
  structure: boolean;
  staffCount: number;
  rowWidth: number;
  canManage: boolean;
  positionsOpen: boolean;
  roots: DepartmentNode[];
  users: readonly UserListItem[];
  toolbar: ReturnType<typeof useListToolbar>;
  filterDefs: FilterFieldDef<UserListItem>[];
  defs: DataTableField<UserListItem>[];
  onInvite: () => void;
  onTogglePositions: () => void;
  onPickDepartment: (id: string) => void;
  onPickEmployee: (user: UserListItem) => void;
}) {
  if (structure) {
    return (
      <StructureHeader
        staffCount={staffCount}
        rowWidth={rowWidth}
        canManage={canManage}
        positionsOpen={positionsOpen}
        roots={roots}
        users={users}
        onInvite={onInvite}
        onTogglePositions={onTogglePositions}
        onPickDepartment={onPickDepartment}
        onPickEmployee={onPickEmployee}
      />
    );
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 pl-6">
      <h1 className="shrink-0 text-xl font-semibold text-balance text-foreground">
        {ui.employees.title}
        <span className="ml-2 align-middle font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
          {staffCount}
        </span>
      </h1>
      <ListToolbar
        className="min-w-0 flex-1 px-0"
        toolbar={toolbar}
        defs={filterDefs}
        left={
          canManage ? (
            <Button onClick={onInvite}>
              <UserPlus data-icon="inline-start" />
              {ui.employees.invite}
            </Button>
          ) : undefined
        }
        right={<ViewSettings viewKey="directory.employees" defs={defs} />}
      />
    </div>
  );
}
