import { useState } from 'react';
import type { TaskDetail, WorkflowAction } from '@nodus/contracts';

import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import {
  TransitionWindow,
  type WindowSource,
} from '../../../shared/workflow/transition-window/transition-window.js';
import {
  transitionWindowError,
  usePressAction,
  useWorkflowActions,
} from '../api/transitions-api.js';
import { windowContextOf } from './task-transition-dialog.js';

/** Окно действия для общего диалога: без целевой стадии, гейтов и обхода —
 *  действие ничего не меняет, только пишет данные окна в журнал. */
function windowSourceOf(action: WorkflowAction): WindowSource {
  return {
    id: action.id,
    name: action.name,
    form: action.form,
    ...(action.formPrefill ? { formPrefill: action.formPrefill } : {}),
    validators: [],
    blockedBy: [],
    canOverride: false,
  };
}

/**
 * Запуск действий карточки (#633): кнопка без смены статуса. Окно включено —
 * диалог с полями, отправка пессимистичная; окно выключено — сразу нажатие.
 * Тост и журнал — в мутации (`usePressAction`).
 */
export function useActionRunner(task: TaskDetail) {
  const { data: actions } = useWorkflowActions(task.id);
  const press = usePressAction(task.id);
  const { data: conversation } = useTaskConversation(task.id);
  const { data: definitions } = useCustomFieldDefinitions('task');
  const taskDefinitions = definitions ?? [];
  const [windowAction, setWindowAction] = useState<WorkflowAction | null>(null);

  function run(action: WorkflowAction) {
    if (press.isPending) return;
    if (action.form) {
      press.reset();
      setWindowAction(action);
      return;
    }
    press.mutate({ action, body: {} });
  }

  const closeWindow = () => {
    setWindowAction(null);
    press.reset();
  };

  const dialog = windowAction ? (
    <TransitionWindow
      open
      mode="live"
      transition={windowSourceOf(windowAction)}
      context={windowContextOf(task, conversation?.id ?? null, taskDefinitions)}
      submitting={press.isPending}
      error={press.error ? transitionWindowError(press.error) : null}
      onCancel={closeWindow}
      onSubmit={(body) => press.mutate({ action: windowAction, body }, { onSuccess: closeWindow })}
    />
  ) : null;

  const runningId = press.isPending ? (press.variables?.action.id ?? null) : null;
  return {
    actions: actions ?? [],
    run,
    dialog,
    isPending: press.isPending,
    runningId,
  };
}
