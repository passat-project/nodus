import { useState } from 'react';
import { toast } from 'sonner';
import type { NodeKind, ProjectNode } from '@nodus/contracts';
import { NODE_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { plural } from '../../../../shared/lib/format.js';
import { useDeleteNode, useMoveNode, useUpdateNode } from '../api/structure-api.js';
import { NodeKindGlyph } from '../lib/node-kind-icon.js';
import { nodeOptions, subtreeNodeIds } from '../lib/structure-tree.js';

/** Переименование узла: имя / шифр / вид уровня (контракт update). */
export function NodeRenameDialog({
  projectId,
  node,
  kinds,
  onClose,
}: {
  projectId: string;
  node: ProjectNode;
  kinds: NodeKind[];
  onClose: () => void;
}) {
  const update = useUpdateNode(projectId);
  const [name, setName] = useState(node.name);
  const [code, setCode] = useState(node.code ?? '');
  const [kindId, setKindId] = useState(node.kindId);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const body: Parameters<typeof update.mutate>[0] = { nodeId: node.id };
    if (trimmed !== node.name) body.name = trimmed;
    if (code.trim() !== (node.code ?? '')) body.code = code.trim() || null;
    if (kindId !== node.kindId) body.kindId = kindId;
    if (Object.keys(body).length <= 1) {
      onClose();
      return;
    }
    update.mutate(body, { onSuccess: onClose });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{ui.structure.rename}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <NodeLabel label={ui.structure.nodeName} />
            <Input
              autoFocus
              value={name}
              maxLength={NODE_LIMITS.nameLength}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          <label className="flex flex-col gap-1">
            <NodeLabel label={ui.structure.nodeCode} />
            <Input
              value={code}
              maxLength={NODE_LIMITS.codeLength}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <NodeLabel label={ui.structure.nodeKind} />
            <Select value={kindId} onValueChange={setKindId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {kinds.map((kind) => (
                  <SelectItem key={kind.id} value={kind.id}>
                    <NodeKindGlyph icon={kind.icon} className="size-3.5 shrink-0" />
                    {kind.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={update.isPending || !name.trim()} onClick={submit}>
            {ui.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
