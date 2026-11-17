import { X } from 'lucide-react';
import type {
  LetterListItem,
  LetterRef,
  LetterRelationKind,
  LetterTreeNode,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { nodeNumber } from './letter-relation-node.js';
import { LetterPickRow, RelationPreview } from './letter-relation-pick.js';
import type { RelationDirection } from './letter-relation-mode-choices.js';

/**
 * Выбранная цель связи и предпросмотр «как встанет в ёлочку» (#461, #611):
 * при обратном направлении родитель и ребёнок меняются местами — ошибку
 * направления видно до нажатия «Связать». Вынесено из окна ради лимита I5.
 */
export function RelationPickedCard({
  picked,
  source,
  kind,
  direction,
  replace,
  replacedWith,
  disabled,
  onClear,
}: {
  picked: LetterListItem;
  source: LetterTreeNode;
  kind: LetterRelationKind;
  direction: RelationDirection;
  replace: boolean;
  replacedWith: LetterRef | null;
  disabled: boolean;
  onClear: () => void;
}) {
  const fromCurrent = direction === 'fromCurrent';
  const pickedLine = { number: picked.regNumber ?? ui.letters.noNumber, subject: picked.subject };
  const sourceLine = { number: nodeNumber(source), subject: source.subject };
  return (
    <>
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 py-2 pr-1.5 pl-3">
        <LetterPickRow letter={picked} />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={ui.common.remove}
          title={ui.common.remove}
          onClick={onClear}
          disabled={disabled}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
      {replace ? (
        <p className="text-xs text-warning">
          {replacedWith
            ? ui.letters.relations.replaceWarning(
                replacedWith.regNumber ?? replacedWith.subject ?? ui.letters.noNumber,
              )
            : ui.letters.relations.replaceUnknown}
        </p>
      ) : null}
      <span className="text-xs font-medium text-muted-foreground">
        {ui.letters.relations.previewCaption}
      </span>
      <RelationPreview
        parent={fromCurrent ? pickedLine : sourceLine}
        child={fromCurrent ? sourceLine : pickedLine}
        kind={kind}
      />
    </>
  );
}
