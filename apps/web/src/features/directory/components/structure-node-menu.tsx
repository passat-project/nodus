import { MoreHorizontal } from 'lucide-react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

/**
 * «⋯» карточки отдела (#768, вердикт 16.11.2026): sibling кнопки-тела, поэтому
 * клик по меню НЕ выбирает отдел; видна администратору всегда, имя обрезается
 * до неё. Пункты: приглашение в Nodus с предвыбранным подразделением (#101) и
 * правка отдела; полное меню действий (перевод сотрудников, удаление с
 * переносом) — #881.
 */
export function StructureNodeMenu({
  node,
  onInvite,
  onEdit,
}: {
  node: DepartmentNode;
  onInvite: (node: DepartmentNode) => void;
  onEdit: (node: DepartmentNode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1 right-1 z-10 text-muted-foreground hover:text-foreground"
          aria-label={ui.employees.departmentActions}
          title={ui.employees.departmentActions}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={6} className="w-auto">
        <DropdownMenuItem onClick={() => onInvite(node)}>
          {ui.employees.inviteToDepartment}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(node)}>
          {ui.employees.editDepartmentAction}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
