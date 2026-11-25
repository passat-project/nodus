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
 * карточка компании не удаляется. Пункты с иконкой, заголовком и коротким
 * пояснением — меню читается без догадок, как в Битриксе.
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
          hint={ui.employees.editDepartmentHint}
          onSelect={() => onEdit(node)}
        />
        <ActionItem
          icon={ArrowRightLeft}
          label={ui.employees.transferFromDepartment}
          hint={ui.employees.transferFromDepartmentHint}
          onSelect={() => onTransfer(node)}
        />
        <ActionItem
          icon={UserPlus}
          label={ui.employees.inviteToDepartment}
          hint={ui.employees.inviteToDepartmentHint}
          onSelect={() => onInvite(node)}
        />
        {mainCard || !canDelete ? null : (
          <>
            <DropdownMenuSeparator />
            <ActionItem
              icon={Trash2}
              label={ui.employees.deleteDepartment}
              hint={ui.employees.deleteDepartmentHint}
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
  hint,
  destructive = false,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      variant={destructive ? 'destructive' : 'default'}
      onSelect={onSelect}
      className="items-start gap-2.5 py-2"
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', !destructive && 'text-muted-foreground')}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate">{label}</span>
        <span className="text-xs font-normal text-muted-foreground">{hint}</span>
      </span>
    </DropdownMenuItem>
  );
}
