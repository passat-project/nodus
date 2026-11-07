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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@nodus/ui/components/select';

import { FormulaMovePreviewDialog } from '../../../../shared/custom-fields/formula/formula-move-preview-dialog.js';
import {
  previewNodeMoveBatch,
  useFormulaMoveGate,
  useNodeMovePreview,
} from '../../../../shared/custom-fields/formula/formula-move-preview.js';
import { plural } from '../../../../shared/lib/format.js';
import { useDeleteNode, useMoveNode } from '../api/structure-api.js';
import { nodeOptions, subtreeNodeIds } from '../lib/structure-tree.js';

/**
 * Строки итога пачки, которых ещё нет в i18n: `ui.structure` живёт в
 * контрактах (`packages/contracts/src/i18n/ru-structure.ts`), а пакет M
 * правит только веб (I15 — перенести следующим пакетом #632, здесь дословно).
 */
const bulkText = {
  /** Итог частичного переноса: «перенесено 2 из 5». */
  partial: (moved: number, total: number) => `Перенесено ${moved} из ${total}`,
  failed: 'Не удалось перенести:',
} as const;

/**
 * Триггер выбора цели (A9-6): путь папки читается ЦЕЛИКОМ — две строки с
 * переносом вместо `line-clamp-1` («Здание 2 — Разд…» не отвечает на вопрос,
 * куда переносим) и `title` с полным именем. Подпись считаем из `options`, а
 * не через `SelectValue`: значение Radix подставляет из смонтированного
 * списка, а он живёт в портале и до первого открытия пуст.
 *
 * Общий для окон переноса папки и задачи (`TaskMoveDialog`) — одна механика
 * читаемой цели в обоих пикерах.
 */
export function TargetSelect({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (next: string) => void;
  items: readonly { id: string; label: string }[];
}) {
  // Отступные «— » дерева в контроле не нужны: имя папки — сам ответ.
  const name =
    items.find((item) => item.id === value)?.label.replace(/^(?:— )+/, '') ??
    (value === 'root' ? ui.structure.rootParent : '');
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-auto min-h-8 w-full items-center text-left whitespace-normal"
        title={name}
      >
        <span className="line-clamp-2 min-w-0 flex-1">{name}</span>
      </SelectTrigger>
      <SelectContent position="popper">
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Перенос узла выбором родителя (меню «Переместить…»); своё поддерево —
 *  недоступно (цикл). Позиция — последним ребёнком (тонкий порядок — DnD).
 *  Перед мутацией — превью формульного диффа (#632): непустой дифф
 *  спрашивает подтверждение, пустой переносит сразу. */
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
  const preview = useNodeMovePreview(projectId);
  const gate = useFormulaMoveGate();
  const [parentId, setParentId] = useState<string>('root');
  const options = [{ id: 'root', label: ui.structure.rootParent }, ...nodeOptions(nodes, node.id)];

  function submit() {
    const target = parentId === 'root' ? null : parentId;
    void gate.offer(preview.mutateAsync({ nodeId: node.id, parentId: target }), () =>
      move.mutate({ nodeId: node.id, parentId: target }, { onSuccess: onClose }),
    );
  }

  // Непустой дифф — шаг подтверждения ВМЕСТО выбора родителя: перенос и
  // пересчёт значений решаются одним намеренным кликом. «Отмена» возвращает
  // к выбору (человек может передумать про родителя, а не про перенос).
  if (gate.pending) return <FormulaMovePreviewDialog {...gate.dialogProps} />;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-lg"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.structure.moveTitle}</DialogTitle>
          <DialogDescription>{node.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.nodeParent} />
          <TargetSelect value={parentId} onChange={setParentId} items={options} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={move.isPending || preview.isPending} onClick={submit}>
            {ui.structure.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Перенос пачки узлов в выбранный родитель (мультиселект строк): сервер
 * двигает по одному, клиент — последовательно; своё поддерево исключено.
 *
 * Перед переносом — сводный дифф формул (A9-2): «что изменится» спрашивается
 * и у папок, а не только у одиночного переноса. Отказ одной папки НЕ рвёт
 * пачку: остальные всё равно переносятся, а окно показывает итог «перенесено
 * k из n» и список неудачных — раньше перенос вставал на первой ошибке, и
 * человек не знал, что уже применилось.
 */
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
  const gate = useFormulaMoveGate();
  const [parentId, setParentId] = useState('root');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    moved: number;
    failed: { id: string; name: string }[];
  } | null>(null);
  const excluded = new Set(nodeIds.flatMap((id) => [...subtreeNodeIds(nodes, id)]));
  const options = [
    { id: 'root', label: ui.structure.rootParent },
    ...nodeOptions(nodes).filter((option) => !excluded.has(option.id)),
  ];
  const total = nodeIds.length;

  async function runMoves(parent: string | null) {
    setRunning(true);
    let moved = 0;
    const failed: { id: string; name: string }[] = [];
    for (const id of nodeIds) {
      try {
        await move.mutateAsync({ nodeId: id, parentId: parent });
        moved += 1;
      } catch {
        // Тост отказа показала мутация; пачку не рвём — остальные папки
        // пользователь всё равно переносит, итог покажет окно.
        failed.push({ id, name: nodes.find((node) => node.id === id)?.name ?? id });
      }
    }
    setRunning(false);
    if (failed.length === 0) {
      toast.success(ui.structure.movedNodes);
      onClose();
      return;
    }
    setResult({ moved, failed });
  }

  function submit() {
    const parent = parentId === 'root' ? null : parentId;
    void gate.offer(previewNodeMoveBatch(projectId, nodeIds, parent), () => void runMoves(parent));
  }

  if (gate.pending) return <FormulaMovePreviewDialog {...gate.dialogProps} />;

  if (result) {
    return (
      <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent
          className="max-w-lg"
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{ui.structure.move}</DialogTitle>
            <DialogDescription>{bulkText.partial(result.moved, total)}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[min(50vh,18rem)] flex-col gap-1 overflow-auto rounded-xl bg-muted/40 p-2">
            <p className="text-xs text-muted-foreground">{bulkText.failed}</p>
            <ul className="flex flex-col gap-1">
              {result.failed.map((node) => (
                <li key={node.id} className="min-w-0 text-[13px] break-words text-foreground">
                  {node.name}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>{ui.common.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-lg"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.structure.move}</DialogTitle>
          <DialogDescription>
            {`${total} ${plural(total, ui.structure.nodeForms)}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.nodeParent} />
          <TargetSelect value={parentId} onChange={setParentId} items={options} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={running} onClick={submit}>
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
