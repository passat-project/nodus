import { ArrowRightLeft, Pencil, Trash2, UserPlus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Единое меню действий с подразделением (#881): одна реализация для «⋯» на
 * карточке структуры и в правой панели. Только администратору; главная
 * карточка компании не удаляется. Пункты — иконка + название (без подписей-
 * пояснений: вердикт приёмки 26.11.2026); ширина — по самому длинному пункту
 * (`w-72`), иначе «Перевести из другого подразделения» обрезается.
 */
export function DepartmentActionsMenu({
  node,
  mainCard,
  canDelete,
  trigger,
  side = 'right',
  align = 'start',
  onEdit,
  onInvite,
  onTransfer,
  onDelete,
}: {
  node: DepartmentNode;
  /** Главная карточка компании: пункт удаления скрыт. */
  mainCard: boolean;
  /** У аномального корня (parentId=null) удаление недоступно — сервер откажет. */
  canDelete: boolean;
  trigger: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  onEdit: (node: DepartmentNode) => void;
  onInvite: (node: DepartmentNode) => void;
  onTransfer: (node: DepartmentNode) => void;
  onDelete: (node: DepartmentNode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} sideOffset={6} className="w-72">
        <ActionItem
          icon={Pencil}
          label={ui.employees.editDepartmentAction}
          onSelect={() => onEdit(node)}
        />
        <ActionItem
          icon={ArrowRightLeft}
          label={ui.employees.transferFromDepartment}
          onSelect={() => onTransfer(node)}
        />
        <ActionItem
          icon={UserPlus}
          label={ui.employees.inviteToDepartment}
          onSelect={() => onInvite(node)}
        />
        {mainCard || !canDelete ? null : (
          <>
            <DropdownMenuSeparator />
            <ActionItem
              icon={Trash2}
              label={ui.employees.deleteDepartment}
              destructive
              onSelect={() => onDelete(node)}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionItem({
  icon: Icon,
  label,
  destructive = false,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      variant={destructive ? 'destructive' : 'default'}
      onSelect={onSelect}
      className="gap-2.5"
    >
      <Icon
        className={cn('size-4 shrink-0', !destructive && 'text-muted-foreground')}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="min-w-0 truncate">{label}</span>
    </DropdownMenuItem>
  );
}
