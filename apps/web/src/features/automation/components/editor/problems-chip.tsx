import type { WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import { CircleAlert } from 'lucide-react';

/** Чип проблем схемы (строка инструментов): красный/жёлтый, клик — список
 *  в поповере; пункт списка выделяет статус или кнопку на холсте. */
export function ProblemsChip({
  problems,
  onProblemClick,
}: {
  problems: readonly WorkflowProblem[];
  onProblemClick: (problem: WorkflowProblem) => void;
}) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const label = `${ui.automation.problemsChip} · ${problems.length}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            // Строка инструментов сужается до ~286px: подпись уходит первой,
            // затем счётчик — приоритет у имени типа и действий бара. Чип не
            // прячется целиком: иначе заблокированная «Опубликовать» остаётся
            // без объяснения (счётчик и имя — в title/aria-label).
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors @max-[560px]:px-1',
            errors > 0
              ? 'border-danger/40 bg-danger-soft/60 text-danger'
              : 'border-warning/40 bg-warning-soft/60 text-warning',
          )}
        >
          <CircleAlert className="size-3.5" strokeWidth={1.75} />
          <span className="@max-[640px]:hidden">
            {ui.automation.problemsChip} · {problems.length}
          </span>
          <span className="hidden @max-[640px]:inline @max-[560px]:hidden">{problems.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="nokey w-80 rounded-[14px] p-1.5">
        {problems.map((problem, index) => (
          <button
            key={`${problem.code}-${problem.stageId ?? problem.transitionId ?? index}`}
            type="button"
            onClick={() => onProblemClick(problem)}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
          >
            <span
              aria-hidden
              className={cn(
                'mt-1.5 size-1.5 shrink-0 rounded-full',
                problem.severity === 'error' ? 'bg-danger' : 'bg-warning',
              )}
            />
            <span className="min-w-0 flex-1">{ui.automation.problems[problem.code]}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
