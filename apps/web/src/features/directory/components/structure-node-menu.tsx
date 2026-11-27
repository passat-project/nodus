import { MoreHorizontal } from 'lucide-react';
import type { DepartmentNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { DepartmentActionsMenu } from './department-actions-menu.js';

/**
 * «⋯» карточки подразделения (#768, вердикт 16.11.2026): sibling кнопки-тела,
 * поэтому клик по меню НЕ выбирает подразделение; видна администратору всегда,
 * имя обрезается до неё. Пункты — общее меню `DepartmentActionsMenu` (#881):
 * правка, перевод сотрудника, приглашение, удаление (кроме главной карточки).
 */
export function StructureNodeMenu({
  node,
  mainCard,
  onInvite,
  onEdit,
  onTransfer,
  onDelete,
}: {
  node: DepartmentNode;
  mainCard: boolean;
  onInvite: (node: DepartmentNode) => void;
  onEdit: (node: DepartmentNode) => void;
  onTransfer: (node: DepartmentNode) => void;
  onDelete: (node: DepartmentNode) => void;
}) {
  return (
    <DepartmentActionsMenu
      node={node}
      mainCard={mainCard}
      canDelete={node.parentId !== null}
      side="right"
      align="start"
      onEdit={onEdit}
      onInvite={onInvite}
      onTransfer={onTransfer}
      onDelete={onDelete}
      trigger={
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
      }
    />
  );
}
