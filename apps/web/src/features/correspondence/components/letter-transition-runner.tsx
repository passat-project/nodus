import { useState } from 'react';
import type {
  ExecuteLetterTransitionResult,
  LetterDetail,
  WorkflowTransition,
} from '@nodus/contracts';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { TransitionWindow } from '../../../shared/workflow/transition-window/transition-window.js';
import type { TransitionWindowContext } from '../../../shared/workflow/transition-window/window-context.js';
import { alreadyRegisteredNumber, registrationIssueOf } from '../api/letters-cache.js';
import { useExecuteLetterTransition } from '../api/letters-mutations.js';
import { RegistrationSection } from './registration/registration-section.js';

/** Контекст окна для письма: окно знает только стадию и вложения карточки;
 *  поля задачи (описание, сроки, время) у письма не участвуют. Экспорт —
 *  окно действия письма (#633) берёт тот же контекст. */
export function letterWindowContextOf(letter: LetterDetail): TransitionWindowContext {
  return {
    entityId: letter.id,
    conversationId: null,
    currentStageName: letter.stage.name,
    fields: {
      description: '',
      deadline: null,
      assigneeId: null,
      plannedMinutes: null,
      customFields: letter.customFields,
    },
    spentMinutes: 0,
    lastResult: null,
    access: { canEdit: false, canLogTime: false, canCheck: false },
    submission: null,
    scope: 'entity',
    customFieldDefinitions: [],
    customFieldRefs: letter.customFieldRefs,
  };
}

/** Тост успеха перехода письма: регистрация — с выданным номером. */
export function toastLetterTransition(result: ExecuteLetterTransitionResult, wasNew: boolean) {
  if (wasNew && result.letter.regNumber) {
    toast.success(`${ui.letters.pipeline.registeredToast} ${result.letter.regNumber}`);
  } else if (wasNew) {
    toast.success(ui.letters.pipeline.closedToast);
  }
}

/**
 * Запуск кнопок маршрута письма (#55, Р1): у каждой кнопки письма есть окно
 * (регистрация с номером или причина) — общий `TransitionWindow`, раздел
 * «Регистрация» рисует хост (`renderSection`). Отправка пессимистична; 422
 * подсвечивает поле, 409 повтора — тост и свежая карточка.
 */
export function useLetterTransitionRunner(
  letter: LetterDetail | undefined,
  onDone?: (result: ExecuteLetterTransitionResult) => void,
) {
  const execute = useExecuteLetterTransition();
  const [open, setOpen] = useState<WorkflowTransition | null>(null);
  const issue = registrationIssueOf(execute.error);

  function close() {
    setOpen(null);
    execute.reset();
  }

  function run(transition: WorkflowTransition) {
    if (!letter || execute.isPending) return;
    execute.reset();
    if (transition.form) {
      setOpen(transition);
      return;
    }
    execute.mutate(
      { letterId: letter.id, transition, body: {} },
      { onSuccess: (result) => onDone?.(result) },
    );
  }

  const dialog =
    letter && open ? (
      <TransitionWindow
        open
        mode="live"
        transition={open}
        context={letterWindowContextOf(letter)}
        submitting={execute.isPending}
        onCancel={close}
        onSubmit={(body) =>
          execute.mutate(
            { letterId: letter.id, transition: open, body },
            {
              onSuccess: (result) => {
                toastLetterTransition(result, letter.registeredAt === null);
                close();
                onDone?.(result);
              },
              onError: (error) => {
                if (alreadyRegisteredNumber(error) !== null) {
                  toast.error(errorMessages[ErrorCode.LETTER_ALREADY_REGISTERED]);
                  close();
                }
              },
            },
          )
        }
        renderSection={(section, ctl) =>
          section.kind === 'registration' ? (
            <RegistrationSection letter={letter} ctl={ctl} serverIssue={issue} />
          ) : undefined
        }
      />
    ) : null;

  return {
    run,
    dialog,
    isPending: execute.isPending,
    runningId: execute.isPending ? (execute.variables?.transition.id ?? null) : null,
  };
}
