import { AlertCircle, Network } from 'lucide-react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';

import type { DepartmentCardStats } from '../lib/department-card-stats.js';
import { DivisionsView, type StructureFocus } from './divisions-view.js';

/**
 * Канвас вкладки «Структура» (#101): состояния загрузки/ошибки/пустой
 * структуры и само дерево. Вынесен из страницы (I5): страница держит
 * композицию вкладок и оверлеев, канвас — только дерево.
 */
export function EmployeesStructureCanvas({
  loading,
  error,
  roots,
  selectedDeptId,
  mainId,
  myDepartmentId,
  focus,
  canManage,
  statsById,
  onRetry,
  onCreateDepartment,
  onSelect,
  onCreateChild,
  onInvite,
  onEdit,
  onLocateMe,
}: {
  loading: boolean;
  error: boolean;
  roots: DepartmentNode[];
  selectedDeptId: string | null;
  mainId: string | null;
  myDepartmentId: string | null;
  focus: StructureFocus | null;
  canManage: boolean;
  statsById: ReadonlyMap<string, DepartmentCardStats>;
  onRetry: () => void;
  onCreateDepartment: () => void;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onInvite: (node: DepartmentNode) => void;
  onEdit: (node: DepartmentNode) => void;
  onLocateMe?: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-10 p-6">
        <Skeleton className="h-28 w-60" />
        <div className="flex gap-4">
          <Skeleton className="h-28 w-60" />
          <Skeleton className="h-28 w-60" />
        </div>
      </div>
    );
  }

  if (error) {
    // Ошибка загрузки дерева — не пустой канвас (#441): сообщение и повтор.
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty className="max-w-sm">
          <EmptyMedia variant="icon">
            <AlertCircle className="size-4" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{ui.employees.departmentsLoadError}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {ui.employees.loadErrorRetry}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (roots.length === 0) {
    // Пустая структура (свежая установка): объясняем, что делать; главной
    // карточки нет.
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty className="max-w-sm">
          <EmptyMedia variant="icon">
            <Network className="size-4" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{ui.employees.noDepartments}</EmptyTitle>
            <EmptyDescription>{ui.employees.noDepartmentsHint}</EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={onCreateDepartment}>
                {ui.employees.createDepartment}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    );
  }

  return (
    <DivisionsView
      roots={roots}
      selectedId={selectedDeptId}
      mainId={mainId}
      myDepartmentId={myDepartmentId}
      focus={focus}
      canManage={canManage}
      statsById={statsById}
      onSelect={onSelect}
      onCreateChild={onCreateChild}
      onInvite={onInvite}
      onEdit={onEdit}
      onLocateMe={onLocateMe}
    />
  );
}
