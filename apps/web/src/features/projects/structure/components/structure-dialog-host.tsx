import type { NodeKind, ProjectNode } from '@nodus/contracts';

import { NodeCreateDialog } from './node-create-dialog.js';
import { NodeBulkMoveDialog, NodeDeleteDialog, NodeMoveDialog } from './node-edit-dialog.js';
import { TaskMoveDialog } from './task-move-dialog.js';

/** Состояние окон вкладки «Структура»: какое окно открыто и над чем. */
export type StructureDialog =
  | { kind: 'create'; parent: ProjectNode | null }
  | { kind: 'moveNode'; node: ProjectNode }
  | { kind: 'moveNodes'; nodeIds: string[] }
  | { kind: 'delete'; node: ProjectNode }
  | { kind: 'moveTasks'; taskIds: string[] };

/** Хост окон вкладки: монтирует ровно одно активное (хук мутации внутри
 *  диалога живёт только пока окно открыто). */
export function StructureDialogHost({
  projectId,
  dialog,
  kinds,
  nodes,
  canSetup,
  onClose,
  onMoveTasks,
}: {
  projectId: string;
  dialog: StructureDialog;
  kinds: NodeKind[];
  nodes: ProjectNode[];
  canSetup: boolean;
  onClose: () => void;
  onMoveTasks: (taskIds: string[], nodeId: string | null) => void;
}) {
  switch (dialog.kind) {
    case 'create':
      return (
        <NodeCreateDialog
          projectId={projectId}
          parent={dialog.parent}
          kinds={kinds}
          canSetup={canSetup}
          onClose={onClose}
        />
      );
    case 'moveNode':
      return (
        <NodeMoveDialog projectId={projectId} node={dialog.node} nodes={nodes} onClose={onClose} />
      );
    case 'moveNodes':
      return (
        <NodeBulkMoveDialog
          projectId={projectId}
          nodeIds={dialog.nodeIds}
          nodes={nodes}
          onClose={onClose}
        />
      );
    case 'delete':
      return <NodeDeleteDialog projectId={projectId} node={dialog.node} onClose={onClose} />;
    case 'moveTasks':
      return (
        <TaskMoveDialog
          count={dialog.taskIds.length}
          nodes={nodes}
          taskId={dialog.taskIds.length === 1 ? dialog.taskIds[0] : undefined}
          onPick={(nodeId) => {
            onMoveTasks(dialog.taskIds, nodeId);
            onClose();
          }}
          onClose={onClose}
        />
      );
  }
}
