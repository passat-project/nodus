import type { LetterTreeNode } from '@nodus/contracts';
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

import { nodeNumber } from './letter-relation-node.js';

/** Подтверждение «Снять связь» (#461, Р1а): связь — смысл цепочки, мимо-
 *  клик по меню не должен её терять. Без ввода — обычное поведение окна
 *  (клик мимо = «нет»), Enter — подтвердить. */
export function LetterUnlinkDialog({
  node,
  parent,
  onCancel,
  onConfirm,
}: {
  /** Узел, чья связь с родителем снимается; null — окно закрыто. */
  node: LetterTreeNode | null;
  parent: LetterTreeNode | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const kind =
    node?.relationKind === 'nested_in'
      ? ui.letters.relations.kindNestedIn
      : ui.letters.relations.kindReplyTo;
  return (
    <Dialog open={node !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="grid-cols-[minmax(0,1fr)] rounded-[14px] p-5 sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{ui.letters.relations.unlinkTitle}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {node
              ? ui.letters.relations.unlinkBody(
                  kind,
                  nodeNumber(node),
                  parent ? nodeNumber(parent) : ui.letters.noNumber,
                )
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {ui.common.cancel}
          </Button>
          <Button variant="destructive" autoFocus onClick={onConfirm}>
            {ui.letters.relations.unlink}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
