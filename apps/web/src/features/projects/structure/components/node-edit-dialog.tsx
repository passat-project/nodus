import { useState } from 'react';
import { toast } from 'sonner';
import type { ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { plural } from '../../../../shared/lib/format.js';
import { useDeleteNode, useMoveNode } from '../api/structure-api.js';
import { nodeOptions, subtreeNodeIds } from '../lib/structure-tree.js';

/** Перенос узла выбором родителя (меню «Переместить…»); своё поддерево —
 *  недоступно (цикл). Позиция — последним ребёнком (тонкий порядок — DnD). */
export function NodeMoveDialog({
  projectId,
  node,
  nodes,
  onClose,
}: {
  projectId: string;
  node: ProjectNode;
  nodes: ProjectNode[];
  onClose: () => void;
}) {
  const move = useMoveNode(projectId);
  const [parentId, setParentId] = useState<string>('root');
  const options = nodeOptions(nodes, node.id);

  function submit() {
    move.mutate(
      { nodeId: node.id, parentId: parentId === 'root' ? null : parentId },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.structure.moveTitle}</DialogTitle>
          <DialogDescription>{node.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.nodeParent} />
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="root">{ui.structure.rootParent}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={move.isPending} onClick={submit}>
            {ui.structure.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Перенос пачки узлов в выбранный родитель (мультиселект строк): сервер
 *  двигает по одному, клиент — последовательно; своё поддерево исключено. */
export function NodeBulkMoveDialog({
  projectId,
  nodeIds,
  nodes,
  onClose,
}: {
  projectId: string;
  nodeIds: string[];
  nodes: ProjectNode[];
  onClose: () => void;
}) {
  const move = useMoveNode(projectId);
  const [parentId, setParentId] = useState('root');
  const [pending, setPending] = useState(false);
  const excluded = new Set(nodeIds.flatMap((id) => [...subtreeNodeIds(nodes, id)]));
  const options = nodeOptions(nodes).filter((option) => !excluded.has(option.id));

  async function submit() {
    setPending(true);
    try {
      for (const id of nodeIds) {
        await move.mutateAsync({
          nodeId: id,
          parentId: parentId === 'root' ? null : parentId,
        });
      }
      toast.success(ui.structure.movedNodes);
      onClose();
    } catch {
      // Тост ошибки уже показан хуком; окно оставляем открытым для повтора.
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.structure.move}</DialogTitle>
          <DialogDescription>
            {`${nodeIds.length} ${plural(nodeIds.length, ui.structure.nodeForms)}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.nodeParent} />
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="root">{ui.structure.rootParent}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={pending} onClick={() => void submit()}>
            {ui.structure.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Удаление узла: только ПУСТОЙ (непустой — 409 от сервера, тост по коду). */
export function NodeDeleteDialog({
  projectId,
  node,
  onClose,
}: {
  projectId: string;
  node: ProjectNode;
  onClose: () => void;
}) {
  const remove = useDeleteNode(projectId);
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ui.structure.deleteTitle}</DialogTitle>
          <DialogDescription>{`${node.name}. ${ui.structure.deleteText}`}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(node.id, { onSuccess: onClose })}
          >
            {ui.structure.remove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
