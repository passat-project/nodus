import { useState } from 'react';
import { Check, ChevronDown, Play, Send, Undo2, Workflow, X, Zap } from 'lucide-react';
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
import { useSubmitPress } from '../api/press-api.js';
import { PauseGlyph } from '../../../shared/ui/pause-glyph.js';
import { stageTone } from '../../../shared/ui/board/stage-tone.js';
import { groupProcessButtons } from '../../../shared/workflow/process-buttons.js';
import { RouteViewDialog } from '../../../shared/workflow/route-view-dialog.js';
import {
  processSlotLabels,
  ProcessButtonSlot,
  type ProcessSlotItem,
} from '../../../shared/workflow/process-button-slot.js';
import { PressAnalyticsDialog, PressSubmitDialog, pressHasWindow } from './task-press-dialogs.js';
import { TaskPressButton, TaskPressStatus } from './task-press-button.js';
import { PressRing } from './task-press.js';
import { useActionRunner } from './task-action-runner.js';
import { TaskTimerButton } from './task-time.js';
import { useTransitionRunner } from './task-transition-dialog.js';

/* Кнопки панели — ОДНОЙ высоты: h-9 = 45px при --ui-scale 1.25 (замер
 * Битрикс24); важность — заливкой, не размером. Главная — одна (залитая),
 * видимые — по порядку, «Ещё ⋯» — меню; порядок и показ задаёт сервер
 * (`display`, sortOrder) — эвристик клиента нет (#378). Фокус — общий канон:
 * невидимая рамка + ring (как у кнопки таймера рядом). */
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
 * кнопки = переходы маршрута типа (ADR-0020) с показом `display` и действия
 * без смены статуса (#633). Заблокированная гейтом кнопка видна приглушённой,
 * клик — диалог причин и выходов; в правом конце — таймер учёта времени.
 * Личная колонка «Моего плана» здесь не показывается (только DnD на доске).
 *
 * ТРИ СЛОТА — закон (решение владельца 16.11.2026): главная →
 * второстепенные → действия, меню «⋯» в панели нет вообще.
 * - один элемент в слоте — обычная кнопка без стрелки; несколько — первая
 *   нажимается сразу, рядом стрелка вверх открывает список остальных;
 * - показ `menu` у перехода и у действия = «в конце списка»: пункт уходит под
 *   разделитель, значение `display` в данных не меняется (маршруты не
 *   мигрируются), панель это рисует в `ProcessButtonSlot`;
 * - главная одна: переход сильнее; если переходов нет — главным становится
 *   первое действие (как было в #742);
 * - причина блокировки — текстом в строке списка, а не только в подсказке.
 * Коллективное нажатие (#707) — ЭТО ПЕРЕХОД: отдельного слота нет, кнопка
 * живёт в слоте второстепенных и не прячется в список (кольцо прогресса
 * обязано быть видно без клика).
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
  const submitPress = useSubmitPress(task.id);
  const [pressOpen, setPressOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const press = task.press;
  const pressedNames = press
    ? press.entries.filter((entry) => entry.state === 'pressed').map((entry) => entry.displayName)
    : [];
  const pressTransition = press
    ? (transitions?.find((t) => t.id === press.transitionId) ?? null)
    : null;

  if (!transitions) {
    return (
      <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
        <span className="ml-auto" />
        {showTime ? <TaskTimerButton task={task} /> : null}
      </div>
    );
  }

  // Окно сбора — окно самой кнопки (#496): есть разделы — показываем его,
  // нет — нажатие сразу записывает отметку без пустого диалога.
  const openPress = () => {
    // Снимок окна раунда — источник истины: правка окна кнопки посреди
    // раунда не должна ломать сдачу (личные разделы проверяются по нему).
    const snapshot = pressTransition && press ? { ...pressTransition, form: press.form } : null;
    if (snapshot && pressHasWindow(snapshot)) setPressOpen(true);
    else submitPress.mutate({});
  };

  const { primary, visible, menu } = groupProcessButtons(transitions);
  // Три слота (решение 16.11.2026): главная → второстепенные → действия.
  // «В меню» у перехода и у действия = «в конце списка»: значение `display`
  // в данных не меняется, опубликованные маршруты не мигрируются.
  const orderedTransitions = [...visible, ...menu];
  // Коллективная кнопка никогда не прячется в список: в слоте второстепенных
  // она занимает видимое место первой, независимо от порядка в маршруте.
  const secondary =
    press && press.canSubmit
      ? [
          ...orderedTransitions.filter((t) => t.id === press.transitionId),
          ...orderedTransitions.filter((t) => t.id !== press.transitionId),
        ]
      : orderedTransitions;
  // Внутри слота действий обычные кнопки идут первыми, «в конце списка» —
  // последними (серверный порядок внутри групп сохраняется).
  const orderedActions = [
    ...actionRunner.actions.filter((action) => action.display !== 'menu'),
    ...actionRunner.actions.filter((action) => action.display === 'menu'),
  ];
  // Главная кнопка одна: переход сильнее; если переходов в панели нет —
  // главным становится первое действие (как было в #742).
  const mainAction = !primary && secondary.length === 0 ? (orderedActions[0] ?? null) : null;
  const slotActions = mainAction
    ? orderedActions.filter((action) => action.id !== mainAction.id)
    : orderedActions;

  const actionItem = (action: WorkflowAction): ProcessSlotItem => {
    const blocked = action.blockedBy.length > 0;
    return {
      id: action.id,
      name: action.name,
      icon: <Zap className="size-4 shrink-0" strokeWidth={1.75} />,
      blocked,
      ...(blocked
        ? { blockedText: `${ui.tasks.processBlockedMissing} ${gateReasonsText(action.blockedBy)}` }
        : {}),
      running: actionRunner.runningId === action.id,
      title: action.form ? `${action.name} — ${ui.tasks.actionOpensWindow}` : action.name,
      rare: action.display === 'menu',
      onSelect: () => actionRunner.run(action),
    };
  };

  const transitionItem = (t: WorkflowTransition, main = false): ProcessSlotItem | null => {
    const isPress = press?.transitionId === t.id;
    // Коллективная кнопка: уже нажавшему/не-участнику кнопку не показываем —
    // прогресс остаётся в чипе «Статусы участников».
    if (isPress && press) {
      if (!press.canSubmit) return null;
      return {
        id: t.id,
        name: t.name,
        icon: <PressRing pressed={press.pressed} total={press.total} />,
        pressNode: (
          <TaskPressButton
            name={t.name}
            pressed={press.pressed}
            total={press.total}
            participants={pressedNames}
            main={main}
            onPress={openPress}
            onOpenStatuses={() => setAnalyticsOpen(true)}
          />
        ),
        title: t.name,
        onSelect: openPress,
      };
    }
    const blocked = t.blockedBy.length > 0;
    const Icon = transitionIcon(t);
    return {
      id: t.id,
      name: t.name,
      icon: <Icon className="size-4 shrink-0" strokeWidth={1.75} />,
      blocked,
      ...(blocked
        ? { blockedText: `${ui.tasks.processBlockedMissing} ${gateReasonsText(t.blockedBy)}` }
        : {}),
      running: runner.runningId === t.id,
      title: `${t.name}: ${t.toStageName}`,
      rare: t.display === 'menu',
      onSelect: () => runner.run(t),
    };
  };

  const closed = isFinalState(task.stage.systemState);
  const cancelled = closed && task.stage.outcome === 'cancelled';
  const rejected = closed && task.stage.outcome === 'rejected';
  const negative = cancelled || rejected;
  const primaryItem = primary ? transitionItem(primary, true) : null;
  const secondaryItems = secondary
    .map((t) => transitionItem(t))
    .filter((item): item is ProcessSlotItem => item !== null);
  const noButtons =
    orderedActions.length === 0 && primaryItem === null && secondaryItems.length === 0 && !press;

  return (
    <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
      {runner.dialog}
      {actionRunner.dialog}
      {press ? (
        <>
          {pressTransition ? (
            <PressSubmitDialog
              task={task}
              transition={{ ...pressTransition, form: press.form }}
              open={pressOpen}
              onClose={() => setPressOpen(false)}
            />
          ) : null}
          <PressAnalyticsDialog
            taskId={task.id}
            press={press}
            open={analyticsOpen}
            onClose={() => setAnalyticsOpen(false)}
          />
        </>
      ) : null}
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
      {/* 1. Главная: один переход либо (если переходов нет) первое действие. */}
      {primaryItem ? (
        <ProcessButtonSlot items={[primaryItem]} main slotLabel={primaryItem.name} />
      ) : null}
      {mainAction ? (
        <ProcessButtonSlot items={[actionItem(mainAction)]} main slotLabel={mainAction.name} />
      ) : null}
      {/* 2. Второстепенные: первая нажимается сразу, остальные — по стрелке. */}
      {secondaryItems.length > 0 ? (
        <ProcessButtonSlot items={secondaryItems} slotLabel={processSlotLabels.secondary} />
      ) : null}
      {/* 3. Действия без смены статуса: одно — кнопкой, два и больше — со списком. */}
      {slotActions.length > 0 ? (
        <ProcessButtonSlot
          items={slotActions.map(actionItem)}
          slotLabel={processSlotLabels.actions}
        />
      ) : null}
      {press && !press.canSubmit ? (
        <TaskPressStatus
          pressed={press.pressed}
          total={press.total}
          participants={pressedNames}
          onOpenStatuses={() => setAnalyticsOpen(true)}
        />
      ) : null}
      {noButtons ? (
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
