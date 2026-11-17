import { useState } from 'react';
import type { LetterDetail, WorkflowAction } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { gateReasonsText } from '../../../shared/tasks/transition-error.js';
import {
  TransitionWindow,
  type WindowSource,
} from '../../../shared/workflow/transition-window/transition-window.js';
import { usePressLetterAction } from '../api/letters-mutations.js';
import { useLetterActions } from '../api/letters-queries.js';
import { letterWindowContextOf } from './letter-transition-runner.js';

/** Действие письма как источник окна — той же формы, что кнопка-переход. */
function windowSourceOf(action: WorkflowAction): WindowSource {
  return {
    id: action.id,
    name: action.name,
    form: action.form,
    ...(action.formPrefill ? { formPrefill: action.formPrefill } : {}),
    validators: action.validators,
    blockedBy: action.blockedBy,
    canOverride: false,
  };
}

/**
 * Действие письма без смены статуса (#633, аудит В1): то же поведение, что у
 * задачи — окно собирает данные, сервер пишет журнал, статус письма прежний.
 * Обход гейта из интерфейса письма не предлагается (`canOverride: false`).
 */
export function useLetterActionRunner(letter: LetterDetail | undefined) {
  const press = usePressLetterAction();
  const { data: actions } = useLetterActions(letter?.id ?? '', Boolean(letter));
  const [open, setOpen] = useState<WorkflowAction | null>(null);

  function run(action: WorkflowAction) {
    if (!letter || press.isPending) return;
    if (action.form) {
      press.reset();
      setOpen(action);
      return;
    }
    if (action.blockedBy.length > 0) {
      toast.error(`${ui.tasks.processBlockedMissing} ${gateReasonsText(action.blockedBy)}`);
      return;
    }
    press.mutate({ letterId: letter.id, action, body: {} });
  }

  const close = () => {
    setOpen(null);
    press.reset();
  };

  const dialog =
    letter && open ? (
      <TransitionWindow
        open
        mode="live"
        transition={windowSourceOf(open)}
        context={letterWindowContextOf(letter)}
        submitting={press.isPending}
        error={null}
        onCancel={close}
        onSubmit={(body) =>
          press.mutate({ letterId: letter.id, action: open, body }, { onSuccess: close })
        }
      />
    ) : null;

  return {
    actions: actions ?? [],
    run,
    dialog,
    runningId: press.isPending ? (press.variables?.action.id ?? null) : null,
  };
}
