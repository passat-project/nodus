import { useState } from 'react';
import { Check, ChevronDown, Workflow } from 'lucide-react';
import type { TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

import { gateReasonsText, useWorkflowTransitions } from '../api/transitions-api.js';
import { stageTone } from '../../../shared/ui/board/stage-tone.js';
import { RouteViewDialog } from '../../../shared/workflow/route-view-dialog.js';
import { useTransitionRunner } from './task-transition-dialog.js';

const valueChip =
  'inline-flex h-6 max-w-full cursor-pointer items-center gap-1.5 rounded border px-1.5 font-mono text-label font-medium tracking-[0.08em] transition-colors hover:brightness-125 data-[state=open]:brightness-125';

/** Поле «Стадия» (глобальная ось): чип текущей стадии + список стадий,
 *  в которые ведут доступные переходы маршрута; последним пунктом —
 *  «Схема маршрута…» (#378). Вынесено из `task-stage-controls.tsx` (I5):
 *  панель кнопок и поле стадии — разные обязанности. */
export function TaskStageField({
  task,
  onOpenSubtask,
}: {
  task: TaskDetail;
  onOpenSubtask?: (id: string) => void;
}) {
  const { data: transitions } = useWorkflowTransitions(task.id);
  const runner = useTransitionRunner(task, onOpenSubtask);
  const [routeOpen, setRouteOpen] = useState(false);
  const tone = stageTone[task.stage.color];
  const shown = transitions?.filter((t) => t.id !== task.press?.transitionId);

  return (
    <>
      {runner.dialog}
      <RouteViewDialog
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        task={task}
        transitions={transitions}
      />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={ui.tasks.fieldStage} className={cn(valueChip, tone.chip)}>
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} />
          <span className="truncate">{task.stage.name}</span>
          <ChevronDown className="size-3 shrink-0 opacity-70" strokeWidth={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem disabled>
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', tone.dot)} />
            <span className="truncate">{task.stage.name}</span>
            <Check className="ml-auto size-3.5 shrink-0 text-port" strokeWidth={2} />
          </DropdownMenuItem>
          {shown?.map((t) => {
            const color = t.toStageColor;
            return (
              <DropdownMenuItem
                key={t.id}
                className={cn(t.blockedBy.length > 0 && 'opacity-50')}
                title={t.blockedBy.length > 0 ? gateReasonsText(t.blockedBy) : undefined}
                onSelect={() => runner.run(t)}
              >
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', stageTone[color].dot)}
                />
                <span className="truncate">{t.toStageName}</span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRouteOpen(true)}>
            <Workflow className="size-3.5" />
            {ui.tasks.processRouteView}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
