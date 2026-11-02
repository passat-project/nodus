import { ArrowRightLeft, Files, FolderPlus, Plus, Settings2, Trash2 } from 'lucide-react';
import { Fragment } from 'react';
import type { ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';
import { cn } from '@nodus/ui/lib/utils';
import type { RowMenuItem } from '../../../../shared/views/row-menu.js';

/** Пункты меню строки дерева структуры (#467): один реестр на «шашку»
 *  (DropdownMenu, модель Битрикс24) и ПКМ (ContextMenu, прецедент чата —
 *  сообщение message-menu.tsx). Действия — коллбэки вкладки. Пакетное
 *  создание — не пункт меню: оно живёт шевроном в окне «Создать узел». */

export interface StructureMenuActions {
  createInside: (parent: ProjectNode) => void;
  addTask: (node: ProjectNode) => void;
  /** «Свойства» — правая панель; доступна всем, кто видит структуру. */
  properties: (node: ProjectNode) => void;
  moveNode: (node: ProjectNode) => void;
  deleteNode: (node: ProjectNode) => void;
}

/** Пункты меню папки: неруководству — только «Свойства» (просмотр, В5);
 *  руководству — создание внутри, задача, свойства, перенос и удаление. */
export function nodeMenuItems(
  node: ProjectNode,
  a: StructureMenuActions,
  canManage: boolean,
): RowMenuItem[] {
  const properties = {
    id: 'properties',
    icon: <Settings2 className="size-3.5" />,
    label: ui.structure.properties,
    onSelect: () => a.properties(node),
  };
  if (!canManage) return [properties];
  return [
    {
      id: 'create-inside',
      icon: <FolderPlus className="size-3.5" />,
      label: ui.structure.createInside,
      onSelect: () => a.createInside(node),
    },
    {
      id: 'add-task',
      icon: <Plus className="size-3.5" />,
      label: ui.structure.addTask,
      onSelect: () => a.addTask(node),
    },
    {
      ...properties,
      separatorBefore: true,
    },
    {
      id: 'move',
      icon: <ArrowRightLeft className="size-3.5" />,
      label: ui.structure.move,
      onSelect: () => a.moveNode(node),
    },
    {
      id: 'delete',
      icon: <Trash2 className="size-3.5" />,
      separatorBefore: true,
      danger: true,
      label: ui.structure.remove,
      onSelect: () => a.deleteNode(node),
    },
  ];
}

export interface TaskMenuActions {
  open: (taskId: string, anchor?: HTMLElement) => void;
  moveTasks: (taskIds: string[]) => void;
  removeFromStructure: (taskId: string) => void;
  /** Задача уже вне структуры — «Убрать» не показывается. */
  inStructure: boolean;
  /** Можно менять узел (права проекта/не архив). */
  canMove: boolean;
}

export function taskMenuItems(taskId: string, a: TaskMenuActions): RowMenuItem[] {
  return [
    {
      id: 'open',
      label: ui.structure.openTask,
      onSelect: () => a.open(taskId),
    },
    ...(a.canMove
      ? [
          {
            id: 'move',
            icon: <ArrowRightLeft className="size-3.5" />,
            label: ui.structure.moveTasksTo,
            separatorBefore: true,
            onSelect: () => a.moveTasks([taskId]),
          },
          ...(a.inStructure
            ? [
                {
                  id: 'remove-from-structure',
                  icon: <Files className="size-3.5" />,
                  label: ui.structure.removeFromStructure,
                  onSelect: () => a.removeFromStructure(taskId),
                },
              ]
            : []),
        ]
      : []),
  ];
}

/** ПКМ-меню из того же реестра пунктов (шашка — RowMenu в row-menu.tsx). */
export function StructureContextMenu({
  items,
  children,
}: {
  items: RowMenuItem[];
  children: React.ReactNode;
}) {
  if (items.length === 0) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              onSelect={item.onSelect}
              className={cn(item.danger && 'text-destructive focus:text-destructive')}
            >
              {item.icon}
              {item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
