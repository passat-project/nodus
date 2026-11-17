import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { plural } from '../../../shared/lib/format.js';

/**
 * Футер карточки отдела (#768): число прямых отделов + шеврон, сворачивающий
 * ветку целиком; у листа — подпись «нет отделов» без шеврона. Футер/шеврон
 * активны на маршруте к выбранному (и у выбранной, если раскрыта).
 */
export function StructureNodeFooter({
  node,
  expanded,
  active,
  onToggle,
}: {
  node: DepartmentNode;
  expanded: boolean;
  /** Тон маршрута: у выбранной и её предков футер ярче. */
  active: boolean;
  onToggle: (id: string) => void;
}) {
  const count = node.children.length;
  return (
    <div className="relative flex h-8 shrink-0 items-center border-t border-border/70 px-2">
      {node.children.length > 0 ? (
        <button
          type="button"
          data-structure-toggle={node.id}
          aria-expanded={expanded}
          aria-label={expanded ? ui.employees.collapseDepartment : ui.employees.expandDepartment}
          title={expanded ? ui.employees.collapseDepartment : ui.employees.expandDepartment}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-label-sm transition-colors hover:text-foreground',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          )}
          <span className="truncate tabular-nums">
            {count} {plural(count, ui.employees.departmentForms)}
          </span>
        </button>
      ) : (
        <span className="truncate px-1 text-label-sm text-muted-foreground">
          {ui.employees.noSubdepartments}
        </span>
      )}
    </div>
  );
}
