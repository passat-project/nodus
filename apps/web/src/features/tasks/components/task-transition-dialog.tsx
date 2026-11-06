import { useState } from 'react';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { effectiveWindowSections, isReviewState, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Textarea } from '@nodus/ui/components/textarea';

import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import {
  TransitionGateDetails,
  type GateDetailsHost,
} from '../../../shared/workflow/transition-window/gate-details.js';
import { TransitionWindow } from '../../../shared/workflow/transition-window/transition-window.js';
import { routeTransition } from '../../../shared/workflow/transition-window/window-can-unblock.js';
import type { TransitionWindowContext } from '../../../shared/workflow/transition-window/window-context.js';
import {
  transitionWindowError,
  useExecuteTransition,
  useSubmitTransitionWindow,
} from '../api/transitions-api.js';

/** Контекст окна из карточки (#380): поля, итог, права, сдача утверждающему;
 *  определения полей области — из реестра (#431), ссылки — из детали. */
function windowContextOf(
  task: TaskDetail,
  conversationId: string | null,
  customFieldDefinitions: TransitionWindowContext['customFieldDefinitions'],
): TransitionWindowContext {
  return {
    entityId: task.id,
    conversationId,
    currentStageName: task.stage.name,
    fields: {
      description: task.description,
      deadline: task.deadline,
      assigneeId: task.assignee?.id ?? null,
      plannedMinutes: task.plannedMinutes,
      customFields: task.customFields ?? {},
    },
    spentMinutes: task.spentMinutes,
    lastResult: task.result ? { text: task.result.text, messageIds: task.result.messageIds } : null,
    access: {
      canEdit: task.access.canEdit,
      canLogTime: task.access.canLogTime,
      canCheck: task.access.canCheck,
    },
    submission:
      isReviewState(task.stage.systemState) && task.result
        ? {
            author: task.result.author,
            result: { text: task.result.text, messageIds: task.result.messageIds },
            createdAt: task.result.createdAt,
          }
        : null,
    scope: 'entity',
    customFieldDefinitions,
    customFieldRefs: task.customFieldRefs ?? [],
  };
}

/** Запуск перехода маршрута (ADR-0020, #311, окно — #380):
 *  - кнопка с окном → окно перехода;
 *  - заблокированная кнопка, которую окно может разблокировать → окно;
 *  - иначе заблокированная → диалог причин с деталями (что именно мешает);
 *  - свободная → сразу, оптимистично. */
export function useTransitionRunner(task: TaskDetail, onOpenSubtask?: (id: string) => void) {
  const execute = useExecuteTransition(task.id);
  const submit = useSubmitTransitionWindow(task.id);
  const { data: conversation } = useTaskConversation(task.id);
  const { data: definitions } = useCustomFieldDefinitions('task');
  const taskDefinitions = definitions ?? [];
  const [pending, setPending] = useState<WorkflowTransition | null>(null);
  const [windowTransition, setWindowTransition] = useState<WorkflowTransition | null>(null);

  function run(t: WorkflowTransition) {
    if (execute.isPending || submit.isPending) return;
    const route = routeTransition(t, task.access);
    if (route === 'window') {
      submit.reset();
      setWindowTransition(t);
      return;
    }
    if (route === 'execute') execute.mutate({ transition: t });
    else setPending(t);
  }

  const closeWindow = () => {
    setWindowTransition(null);
    submit.reset();
  };

  const dialog = (
    <>
      <TransitionDialog
        transition={pending}
        onClose={() => setPending(null)}
        onExecute={(vars) => execute.mutate(vars, { onSuccess: () => setPending(null) })}
        executing={execute.isPending}
        gate={{
          task,
          definitions: taskDefinitions,
          onOpenSubtask: (id) => {
            setPending(null);
            onOpenSubtask?.(id);
          },
        }}
      />
      {windowTransition ? (
        <TransitionWindow
          open
          mode="live"
          transition={windowTransition}
          context={windowContextOf(task, conversation?.id ?? null, taskDefinitions)}
          submitting={submit.isPending}
          error={submit.error ? transitionWindowError(submit.error) : null}
          onCancel={closeWindow}
          onSubmit={(body, override) =>
            submit.mutate(
              {
                transition: windowTransition,
                body: { ...body, ...(override ?? {}) },
              },
              { onSuccess: closeWindow },
            )
          }
          onOpenChecklist={closeWindow}
          onOpenSubtasks={closeWindow}
          gate={{
            task,
            definitions: taskDefinitions,
            onOpenSubtask: (id) => {
              closeWindow();
              onOpenSubtask?.(id);
            },
          }}
        />
      ) : null}
    </>
  );
  /** Кнопка в ходе (спиннер на ней; панель не гаснет — чип уже сменился). */
  const running = windowTransition ?? execute.variables?.transition ?? null;
  return {
    run,
    dialog,
    isPending: execute.isPending || submit.isPending,
    runningId: execute.isPending || submit.isPending ? (running?.id ?? null) : null,
  };
}

/** Диалог отказа: что именно мешает и как обойти (право `override`).
 *  Автозакрытия подзадач нет — решение владельца 20.10.2026 (#391):
 *  подзадачи закрываются людьми своими маршрутами, окно объясняет. */
export function TransitionDialog({
  transition,
  onClose,
  onExecute,
  executing,
  gate,
}: {
  transition: WorkflowTransition | null;
  onClose: () => void;
  onExecute: (vars: {
    transition: WorkflowTransition;
    override?: boolean;
    reason?: string;
  }) => void;
  executing: boolean;
  gate: GateDetailsHost;
}) {
  const [reason, setReason] = useState('');
  const reasons = transition?.blockedBy ?? [];
  const allowReview =
    transition?.validators.find((validator) => validator.kind === 'no_open_subtasks')
      ?.allowReview ?? false;
  // Окно доступно, но не разблокирует (подзадачи/чек-лист) — показываем
  // подсказку: остальные условия можно дозаполнить в окне.
  const windowHelpful =
    transition !== null &&
    effectiveWindowSections(transition.form, { validators: transition.validators }).length > 0;

  return (
    <Dialog
      open={transition !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setReason('');
        }
      }}
    >
      {/* Окно с вводом причины не закрывается кликом мимо (канон 30.09.2026,
          #511): случайный клик не должен терять введённое; отмена — кнопка
          или Esc, углового крестика нет. */}
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {transition?.name} — {ui.tasks.transitionBlocked.toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {windowHelpful ? ui.tasks.window.overrideSection : ui.tasks.transitionBlockedHint}
          </DialogDescription>
        </DialogHeader>
        <TransitionGateDetails reasons={reasons} gate={gate} allowReview={allowReview} />
        {transition?.canOverride ? (
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={ui.tasks.overrideReason}
            aria-label={ui.tasks.overrideReason}
            className="min-h-16 text-sm"
          />
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.close}
          </Button>
          {transition?.canOverride ? (
            <Button
              variant="outline"
              disabled={!reason.trim() || executing}
              onClick={() =>
                transition && onExecute({ transition, override: true, reason: reason.trim() })
              }
            >
              {ui.tasks.overrideGate}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
