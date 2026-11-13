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
  Zap,
} from 'lucide-react';
import type { TaskDetail, WorkflowAction, WorkflowTransition } from '@nodus/contracts';
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
import { ACTIONS_INLINE_MAX, TaskActionsMenu } from './task-actions-menu.js';
import { useActionRunner } from './task-action-runner.js';
import { TaskTimerButton } from './task-time.js';
import { useTransitionRunner } from './task-transition-dialog.js';

/* Кнопки панели — ОДНОЙ высоты: h-9 = 45px при --ui-scale 1.25 (замер
 * Битрикс24); важность — заливкой, не размером. Главная — одна (залитая),
 * видимые — по порядку, «Ещё ⋯» — меню; порядок и показ задаёт сервер
 * (`display`, sortOrder) — эвристик клиента нет (#378). Фокус — общий канон:
 * невидимая рамка + ring (как у кнопки таймера рядом). */
const btnBase =
  'inline-flex h-9 items-center gap-2 rounded-md border border-transparent px-3 text-sm font-medium transition-colors outline-none disabled:opacity-40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30';
/** Кнопка перехода и «⋯»: ширину не отдаёт — при нехватке места уступает
 *  блок действий, а не названия переходов. */
const btn = `${btnBase} shrink-0`;
/** Кнопка действия: сжимается первой (`flex-shrink: 3` против 0 у переходов). */
const actionBtn = `${btnBase} min-w-0 [flex-shrink:3]`;
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
 *
 * ПОРЯДОК ПАНЕЛИ — ЗАКОН (#633, стык с #707):
 *   закрытая стадия → переходы (включая коллективную кнопку с кольцом) →
 *   действия → «⋯» меню процесса → таймер.
 * Коллективное нажатие (#707) — ЭТО ПЕРЕХОД: отдельного слота нет, кнопку
 * рисует наш же `renderButton` (шире обычной, с кольцом прогресса), поэтому
 * панель её не различает и ничего не дублирует. Действий в ряд — не больше
 * одного: от двух уходим в «Действия» ▾ со счётчиком (`ACTIONS_INLINE_MAX`),
 * а действие с `display: 'menu'` уходит туда ВСЕГДА — даже единственное
 * (настройку «в меню» из конструктора маршрута не теряем).
 * При нехватке ширины первым сжимается блок действий, названия переходов
 * остаются целиком (обрезаем только экстремально длинные, с `title`).
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
  const actionRunner = useActionRunner(task);

  if (!transitions) {
    return (
      <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
        <span className="ml-auto" />
        {showTime ? <TaskTimerButton task={task} /> : null}
      </div>
    );
  }

  const { primary, visible, menu } = groupProcessButtons(transitions);
  // Действия (#633): вид задаёт количество ИЛИ серверный `display`.
  //   `menu` у действия — всегда список (даже единственное: пункт один,
  //   счётчик «1» честно говорит, сколько там);
  //   иначе 1 действие — своя кнопка с полным названием, 2+ — список.
  // Настройку конструктора маршрута не теряем: «в меню» остаётся «в меню».
  const actionCount = actionRunner.actions.length;
  const onlyAction = actionRunner.actions[0] ?? null;
  const singleAction =
    actionCount === ACTIONS_INLINE_MAX && onlyAction?.display !== 'menu' ? onlyAction : null;
  const actionsMany = actionCount > 0 && !singleAction;
  // Залитая кнопка в баре одна: главный переход сильнее, иначе главным
  // становится единственное действие (переходов нет).
  const actionMain = !primary && visible.length === 0;
  const closed = isFinalState(task.stage.systemState);
  const cancelled = closed && task.stage.outcome === 'cancelled';
  const rejected = closed && task.stage.outcome === 'rejected';
  const negative = cancelled || rejected;
  const noButtons = actionCount === 0 && transitions.length === 0;

  const renderAction = (action: WorkflowAction, main: boolean) => {
    const blocked = action.blockedBy.length > 0;
    const running = actionRunner.runningId === action.id;
    const Icon = running ? Loader2 : Zap;
    return (
      <button
        key={action.id}
        type="button"
        aria-busy={running || undefined}
        // Как у кнопки перехода: заблокированная видна и объясняет причину,
        // нажатие открывает окно причин/ведёт к 409 с причинами.
        data-blocked={blocked || undefined}
        aria-label={action.name}
        title={
          blocked
            ? `${ui.tasks.processBlockedMissing} ${gateReasonsText(action.blockedBy)}`
            : action.name
        }
        onClick={() => actionRunner.run(action)}
        className={cn(
          actionBtn,
          main
            ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          blocked && 'opacity-50',
        )}
      >
        <Icon className={cn('size-4 shrink-0', running && 'animate-spin')} strokeWidth={1.75} />
        {/* Название действия целиком; при нехватке ширины уступает именно
            блок действий — первым делом подпись (в узком контейнере остаётся
            значок с подсказкой), а не название перехода. */}
        <span className={cn('min-w-0 whitespace-nowrap', !main && '@max-[420px]:hidden')}>
          {action.name}
        </span>
      </button>
    );
  };

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
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          blocked && 'opacity-50',
        )}
      >
        <Icon className={cn('size-4 shrink-0', running && 'animate-spin')} strokeWidth={1.75} />
        {/* Переход не режем ради действий: подпись до 16rem (прежний потолок
            9rem читался «Приоста…»), `truncate` — предохранитель для
            экстремально длинного имени (полное — в `title`). В контейнере уже
            420px подписи вторичных кнопок уходят в значок — иначе бар не
            влезает в дефолтную колонку карточки (340px). */}
        <span className={cn('max-w-64 truncate', !main && '@max-[420px]:hidden')}>{t.name}</span>
      </button>
    );
  };

  const menuCount = menu.length;

  return (
    <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
      {runner.dialog}
      {actionRunner.dialog}
      {closed ? (
        <span
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium',
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
      {/* 2. Переходы — целиком: при нехватке ширины уступает блок действий.
          Коллективная кнопка (#707) — тоже переход, рисуется здесь же. */}
      {primary ? renderButton(primary, true) : null}
      {visible.map((t) => renderButton(t, false))}
      {/* 3. Действия: одно — кнопкой, два и больше — «Действия» ▾. */}
      {transitions.length > 0 && actionCount > 0 ? (
        <span className="h-5 w-px shrink-0 bg-border/60" aria-hidden />
      ) : null}
      {actionsMany ? (
        <TaskActionsMenu
          actions={actionRunner.actions}
          runningId={actionRunner.runningId}
          onRun={actionRunner.run}
        />
      ) : singleAction ? (
        renderAction(singleAction, actionMain)
      ) : null}
      {noButtons ? (
        <span className="px-1 text-sm text-muted-foreground">
          {task.access.canEdit ? ui.tasks.processNoActions : ui.tasks.processObserving}
        </span>
      ) : null}
      {/* 4. «⋯» — меню процесса (переходы с показом `menu`) у правого края,
          5. таймер — последним. */}
      <span className="ml-auto" />
      {menuCount > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={ui.tasks.moreActions}
            title={ui.tasks.moreActions}
            className={cn(btn, 'px-2 text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
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
