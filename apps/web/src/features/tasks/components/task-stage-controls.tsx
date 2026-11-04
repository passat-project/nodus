import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Play,
  Send,
  Undo2,
  Workflow,
  X,
} from 'lucide-react';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { isFinalState, isReviewState, ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';
import type { LucideIcon } from 'lucide-react';

import { gateReasonsText, useWorkflowTransitions } from '../api/transitions-api.js';
import { PauseGlyph } from '../../../shared/ui/pause-glyph.js';
import { stageTone } from '../../../shared/ui/board/stage-tone.js';
import { groupProcessButtons } from '../../../shared/workflow/process-buttons.js';
import { RouteViewDialog } from '../../../shared/workflow/route-view-dialog.js';
import { TaskTimerButton } from './task-time.js';
import { useTransitionRunner } from './task-transition-dialog.js';

/* Кнопки панели — ОДНОЙ высоты: h-8 = 40px при --ui-scale 1.25 (замер
 * Битрикс24); важность — заливкой, не размером. Главная — одна (залитая),
 * видимые — по порядку, «Ещё ⋯» — меню; порядок и показ задаёт сервер
 * (`display`, sortOrder) — эвристик клиента нет (#378). */
const btn =
  'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-40';
const valueChip =
  'inline-flex h-6 max-w-full cursor-pointer items-center gap-1.5 rounded border px-1.5 font-mono text-label font-medium tracking-[0.08em] transition-colors hover:brightness-125 data-[state=open]:brightness-125';

/** Иконка кнопки — по этапу цели (#378): вперёд/пауза/на утверждение/
 *  итог (✓ выполнена, ✕ отменена)/возврат в ожидание. */
export function transitionIcon(t: WorkflowTransition): LucideIcon | typeof PauseGlyph {
  if (t.toStageState === 'active') return Play;
  if (t.toStageState === 'paused') return PauseGlyph;
  if (isReviewState(t.toStageState)) return Send;
  if (isFinalState(t.toStageState)) {
    return t.toStageOutcome === 'success' ? Check : X;
  }
  return Undo2;
}

/**
 * Панель процесса — замоноличенный нижний бар карточки (модель Битрикса):
 * кнопки = переходы маршрута типа (ADR-0020) с показом `display`. Главная
 * слева залитой, далее видимые по порядку, «Ещё ⋯» — меню. Заблокированная
 * гейтом кнопка видна приглушённой, клик — диалог причин и выходов; в
 * правом конце — таймер учёта времени. Личная колонка «Моего плана» здесь
 * не показывается (только DnD на доске).
 */
export function TaskActionBar({
  task,
  showTime = true,
  onOpenSubtask,
}: {
  task: TaskDetail;
  showTime?: boolean;
  onOpenSubtask?: (id: string) => void;
}) {
  const { data: transitions } = useWorkflowTransitions(task.id);
  const runner = useTransitionRunner(task, onOpenSubtask);

  if (!transitions) {
    return (
      <div className="flex w-full min-w-0 items-center gap-1.5">
        <span className="ml-auto" />
        {showTime ? <TaskTimerButton task={task} /> : null}
      </div>
    );
  }

  const { primary, visible, menu } = groupProcessButtons(transitions);
  const closed = isFinalState(task.stage.systemState);
  const cancelled = closed && task.stage.outcome === 'cancelled';
  const rejected = closed && task.stage.outcome === 'rejected';
  const negative = cancelled || rejected;

  const renderButton = (t: WorkflowTransition, main: boolean) => {
    const blocked = t.blockedBy.length > 0;
    const running = runner.runningId === t.id;
    const Icon = running ? Loader2 : transitionIcon(t);
    return (
      <button
        key={t.id}
        type="button"
        // Панель не гаснет во время хода (чип уже сменился оптимистично):
        // повторный клик гасит сам runner; у нажатой — спиннер.
        aria-busy={running || undefined}
        // НЕ aria-disabled: кнопка работает — открывает диалог причин.
        data-blocked={blocked || undefined}
        aria-label={t.name}
        title={
          blocked
            ? `${ui.tasks.processBlockedMissing} ${gateReasonsText(t.blockedBy)}`
            : `${t.name}: ${t.toStageName}`
        }
        onClick={() => runner.run(t)}
        className={cn(
          btn,
          main
            ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
            : 'min-w-0 shrink text-muted-foreground hover:bg-accent hover:text-foreground',
          blocked && 'opacity-50',
        )}
      >
        <Icon className={cn('size-4 shrink-0', running && 'animate-spin')} strokeWidth={1.75} />
        {/* Узкая левая зона: вторичная кнопка — только значок с подсказкой. */}
        <span className={cn('max-w-36 min-w-0 truncate', !main && '@max-[420px]:hidden')}>
          {t.name}
        </span>
      </button>
    );
  };

  return (
    <div className="flex w-full min-w-0 items-center gap-1.5">
      {runner.dialog}
      {closed ? (
        <span
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium',
            negative ? stageTone.danger.chip : stageTone.success.chip,
          )}
        >
          {negative ? (
            <X className="size-4" strokeWidth={2} />
          ) : (
            <Check className="size-4" strokeWidth={2} />
          )}
          {task.stage.name}
        </span>
      ) : null}
      {primary ? renderButton(primary, true) : null}
      {visible.map((t) => renderButton(t, false))}
      {menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={ui.tasks.moreActions}
            title={ui.tasks.moreActions}
            className={cn(btn, 'px-2 text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            {menu.map((t) => (
              <DropdownMenuItem
                key={t.id}
                className={cn(t.blockedBy.length > 0 && 'opacity-50')}
                title={
                  t.blockedBy.length > 0
                    ? `${ui.tasks.processBlockedMissing} ${gateReasonsText(t.blockedBy)}`
                    : t.toStageName
                }
                onSelect={() => runner.run(t)}
              >
                {t.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {transitions.length === 0 ? (
        <span className="px-1 text-sm text-muted-foreground">
          {task.access.canEdit ? ui.tasks.processNoActions : ui.tasks.processObserving}
        </span>
      ) : null}
      <span className="ml-auto" />
      {showTime ? <TaskTimerButton task={task} /> : null}
    </div>
  );
}

/** Поле «Стадия» (глобальная ось): чип текущей стадии + список стадий,
 *  в которые ведут доступные переходы маршрута; последним пунктом —
 *  «Схема маршрута…» (#378). */
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
          {transitions?.map((t) => {
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
