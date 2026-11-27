import { Check, ExternalLink, X } from 'lucide-react';
import type { TransitionBlockReason } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import {
  gateDetailText,
  MissingFields,
  OpenSubtasksList,
  type GateDetailsHost,
} from './gate-details.js';
import type { WindowConditionLine } from './window-conditions.js';

/**
 * Живой список условий кнопки в окне (#380): ✓/✗ по мере заполнения;
 * неисправимые окном (подзадачи, чек-лист) — с деталями: незакрытые
 * подзадачи списком с переходом, незаполненные поля по именам, «n из m».
 * `aria-live` — состояние меняется без перерисовки фокуса.
 */
export function ConditionsList({
  lines,
  reasons = [],
  gate,
  onOpenChecklist,
  onOpenSubtasks,
}: {
  lines: readonly WindowConditionLine[];
  reasons?: readonly TransitionBlockReason[];
  gate?: GateDetailsHost;
  onOpenChecklist?: () => void;
  onOpenSubtasks?: () => void;
}) {
  if (lines.length === 0) return null;
  return (
    <ul aria-live="polite" className="flex flex-col gap-1">
      {lines.map((line) => {
        const kind = line.validator.kind;
        const reason = reasons.find((item) => item.kind === kind);
        const detail = reason && !line.ok ? gateDetailText(reason, gate?.task) : null;
        const subtasks =
          !line.ok && kind === 'no_open_subtasks' && gate ? (
            <OpenSubtasksList
              subtasks={gate.task.subtasks}
              allowReview={
                line.validator.kind === 'no_open_subtasks' ? line.validator.allowReview : undefined
              }
              onOpen={gate.onOpenSubtask}
            />
          ) : null;
        const fields =
          !line.ok && kind === 'fields_required' ? (
            <MissingFields fields={reason?.fields} definitions={gate?.definitions ?? []} />
          ) : null;
        const action =
          kind === 'checklist_complete' && !line.ok
            ? { label: ui.tasks.window.openChecklist, onClick: onOpenChecklist }
            : kind === 'no_open_subtasks' && !line.ok && !gate
              ? { label: ui.tasks.window.openSubtasks, onClick: onOpenSubtasks }
              : null;
        return (
          <li key={kind} className="flex flex-col gap-1">
            <div className="flex items-start gap-1.5 text-xs">
              {line.ok ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" strokeWidth={2} />
              ) : (
                <X className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={2} />
              )}
              <span
                className={cn('min-w-0', line.ok ? 'text-muted-foreground' : 'text-foreground')}
              >
                {/* ✓ — положительная формулировка («Нет незавершённых подзадач»),
                    ✗ — текст отказа из gate.*: та же фраза, что в диалоге
                    блокировки, не читается наоборот (#511). records/formula
                    (#635) не чинятся окном — ✗ показывает подпись настройки. */}
                {line.ok
                  ? ui.tasks.window.conditionLabels[kind]
                  : (reason?.title ?? ui.tasks.gate[kind])}
                {detail ? ` · ${detail}` : ''}
                {action?.onClick ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="ml-1 h-auto gap-1 p-0 text-xs"
                    onClick={action.onClick}
                  >
                    {action.label}
                    <ExternalLink className="size-3" strokeWidth={1.75} />
                  </Button>
                ) : null}
              </span>
            </div>
            {subtasks || fields ? (
              <div className="ml-5 flex flex-col gap-1">
                {subtasks}
                {fields}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
