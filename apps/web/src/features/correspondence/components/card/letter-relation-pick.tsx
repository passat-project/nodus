import { Layers, Lock, Reply } from 'lucide-react';
import type { LetterListItem, LetterRelationKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { orthPath, snapPx } from '@nodus/ui/components/node-edge';

import { uiPx } from '../../../../shared/ui/ui-scale.js';
import { formatIsoDate } from '../../lib/letter-format.js';

/** Строка письма в выдаче и в «выбранном»: номер · тема · корреспондент · дата. */
export function LetterPickRow({ letter }: { letter: LetterListItem }) {
  return (
    <>
      <span className="w-24 shrink-0 truncate font-mono text-label-sm text-muted-foreground tabular-nums">
        {letter.regNumber ?? ui.letters.noNumber}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1 text-sm">
          {letter.confidential ? (
            <Lock
              aria-label={ui.letters.confidential.badge}
              className="size-3 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
          ) : null}
          <span className="truncate">{letter.subject ?? ui.letters.noSubject}</span>
        </span>
        {letter.counterparty ? (
          <span className="truncate text-xs text-muted-foreground">{letter.counterparty.name}</span>
        ) : null}
      </span>
      <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
        {letter.regDate ? formatIsoDate(letter.regDate) : ''}
      </span>
    </>
  );
}

/** Как связь встанет в «ёлочку»: выбранное письмо — родитель, источник —
 *  его ребёнок по выбранному виду (грамматика графа панели: порт, локоть,
 *  активный порт источника со свечением). Канцелярия видит направление
 *  связи до «Связать» — «ответ на» и «вложено в» легко перепутать. */
export function RelationPreview({
  parent,
  child,
  kind,
}: {
  parent: { number: string; subject: string | null };
  child: { number: string; subject: string | null };
  kind: LetterRelationKind;
}) {
  const KindIcon = kind === 'nested_in' ? Layers : Reply;
  // Ряды h-9 под py-1: центры строк и порты — из тех же величин (ui-scale).
  const parentY = snapPx(uiPx(4 + 18));
  const childY = snapPx(uiPx(4 + 36 + 18));
  const px = snapPx(uiPx(16));
  const childX = snapPx(uiPx(32));
  const row = (item: { number: string; subject: string | null }, extra?: React.ReactNode) => (
    <span className="flex h-9 min-w-0 items-center gap-2">
      <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
        {item.number}
      </span>
      <span className="min-w-0 truncate text-sm">{item.subject ?? ui.letters.noSubject}</span>
      {extra}
    </span>
  );
  return (
    <div className="relative rounded-lg bg-muted/60 py-1 pr-3 pl-12">
      <svg
        aria-hidden
        width={uiPx(44)}
        height={uiPx(80)}
        className="pointer-events-none absolute top-0 left-0 text-edge"
      >
        <path
          d={orthPath(
            [
              { x: px, y: parentY + 4 },
              { x: px, y: childY },
              { x: childX - 3.5, y: childY },
            ],
            6,
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
        />
        <circle cx={px} cy={parentY} r={3} className="fill-port/50" />
        <circle
          cx={childX}
          cy={childY}
          r={3.5}
          className="fill-port"
          style={{ filter: 'drop-shadow(var(--glow))' }}
        />
      </svg>
      {row(parent)}
      {row(
        child,
        <span className="ml-auto flex shrink-0 items-center gap-1 text-label-sm text-muted-foreground">
          <KindIcon aria-hidden className="size-3" strokeWidth={1.75} />
          {kind === 'nested_in'
            ? ui.letters.relations.nodeNestedIn
            : ui.letters.relations.nodeReplyTo}
        </span>,
      )}
    </div>
  );
}
