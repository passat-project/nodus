import { ArrowDown, ArrowUp } from 'lucide-react';
import { ui } from '@nodus/contracts';

/** Стрелки порядка строки панели (кнопки из статуса, действия): видны на
 *  ховере строки. Общие для разделов — порядок в карточке один и тот же. */
export function ReorderButtons({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  return (
    <span className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        aria-label={ui.automation.moveUp}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
      >
        <ArrowUp className="size-3" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={ui.automation.moveDown}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
      >
        <ArrowDown className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}
