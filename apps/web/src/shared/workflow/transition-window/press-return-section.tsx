import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import type { TransitionWindowContext } from './window-context.js';

/**
 * «Кому вернуть» (#434, В2): окно возврата в статус с коллективной кнопкой.
 * Выбранные снова увидят кнопку; остальные сохранят отметки прошлого цикла.
 */
export function PressReturnSection({
  pressReturn,
  selected,
  onChange,
}: {
  pressReturn: NonNullable<TransitionWindowContext['pressReturn']>;
  selected: readonly string[];
  onChange: (userIds: string[]) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border/70 p-3">
      <NodeLabel label={ui.tasks.press.returnToTitle} />
      <p className="text-xs text-muted-foreground">{ui.tasks.press.returnToHint}</p>
      <div className="flex flex-col gap-1">
        {pressReturn.candidates.map((candidate) => (
          <label key={candidate.userId} className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={selected.includes(candidate.userId)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, candidate.userId]
                    : selected.filter((id) => id !== candidate.userId),
                )
              }
            />
            <span className="truncate">{candidate.displayName}</span>
            {candidate.state === 'returned' ? (
              <span className="text-xs text-muted-foreground">{ui.tasks.press.returned}</span>
            ) : null}
          </label>
        ))}
      </div>
    </section>
  );
}
