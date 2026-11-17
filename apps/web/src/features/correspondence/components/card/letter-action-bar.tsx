import {
  ArrowRight,
  Check,
  Loader2,
  MoreHorizontal,
  Stamp,
  Trash2,
  UserPlus,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LetterDetail, WorkflowTransition } from '@nodus/contracts';
import { ErrorCode, errorMessages, isFinalState, ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { ApiError } from '../../../../shared/api-client.js';
import { lettersKeys } from '../../../../shared/api/letters-keys.js';
import { gateReasonsText } from '../../../../shared/tasks/transition-error.js';
import { stageTone } from '../../../../shared/ui/board/stage-tone.js';
import {
  processSlotLabels,
  ProcessButtonSlot,
  type ProcessSlotItem,
} from '../../../../shared/workflow/process-button-slot.js';
import { groupProcessButtons } from '../../../../shared/workflow/process-buttons.js';
import { alreadyRegisteredNumber, registrationIssueOf } from '../../api/letters-cache.js';
import { useExecuteLetterTransition } from '../../api/letters-mutations.js';
import { useLetterTransitions, useReceiptMethods } from '../../api/letters-queries.js';
import { letterRegistrationInput } from '../../lib/registration-draft.js';
import { useLetterActionRunner } from '../letter-action-runner.js';
import { toastLetterTransition, useLetterTransitionRunner } from '../letter-transition-runner.js';

/* Кнопки бара — одной высоты h-8 (канон панели процесса задачи); важность —
 * заливкой: главная одна, видимые по порядку, «Ещё ⋯» — меню. */
const btn =
  'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-40';

const isRegistration = (t: WorkflowTransition) =>
  t.form?.sections.some((section) => section.kind === 'registration') ?? false;

/** Иконка кнопки письма: регистрация — штамп, в закрытие — крестик/галка,
 *  дальше по маршруту — стрелка. */
function transitionIcon(t: WorkflowTransition): LucideIcon {
  if (isRegistration(t)) return Stamp;
  if (isFinalState(t.toStageState)) return t.toStageOutcome === 'success' ? Check : X;
  return ArrowRight;
}

/** 422 прямой регистрации — молча уходим в окно: оно и есть контроль
 * пропусков, сырую ошибку не показываем. */
const isValidationRefusal = (error: unknown) =>
  registrationIssueOf(error) !== null || (error instanceof ApiError && error.status === 422);

/**
 * Нижний бар карточки письма (h-16, замоноличен; #55, U7; редизайн #56):
 * кнопки маршрута типа письма. «Зарегистрировать» у нового письма, когда
 * все обязательные поля заполнены по месту в карточке, идёт НАПРЯМУЮ —
 * номер присваивается сразу, без окна; что-то пусто или сервер отказал
 * 422 — окно (контроль пропусков). У зарегистрированного — переходы по
 * маршруту; закрытое письмо — чип итога. В «Ещё» — пункты меню, «Пригласить
 * в обсуждение» (канцелярия) и «Удалить как спам» (новое). Справа —
 * «Присоединиться» / «Начать обсуждение» (незарегистрированное, канцелярия),
 * пока сотрудник не в чате письма.
 */
export function LetterActionBar({
  letter,
  onInvite,
  onDeleteSpam,
}: {
  letter: LetterDetail;
  onInvite: () => void;
  onDeleteSpam: () => void;
}) {
  const { data: transitions } = useLetterTransitions(letter.id);
  const runner = useLetterTransitionRunner(letter);
  const actionRunner = useLetterActionRunner(letter);
  const execute = useExecuteLetterTransition();
  const { data: methods = [] } = useReceiptMethods();
  const queryClient = useQueryClient();
  const [directId, setDirectId] = useState<string | null>(null);
  const closed = isFinalState(letter.stage.systemState);
  const { primary, visible, menu } = groupProcessButtons(transitions ?? []);
  // Действия (#633, аудит В1): обычные первыми, показ `menu` — в конце слота.
  const orderedActions = [
    ...actionRunner.actions.filter((action) => action.display !== 'menu'),
    ...actionRunner.actions.filter((action) => action.display === 'menu'),
  ];
  const mainAction = !primary && visible.length === 0 ? (orderedActions[0] ?? null) : null;
  const slotActions = mainAction
    ? orderedActions.filter((action) => action.id !== mainAction.id)
    : orderedActions;
  const actionItem = (action: (typeof orderedActions)[number]): ProcessSlotItem => {
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
      title: action.name,
      rare: action.display === 'menu',
      onSelect: () => actionRunner.run(action),
    };
  };
  const hasMenu = menu.length > 0 || letter.access.canDeleteSpam || letter.access.canEdit;

  /** Регистрация из карточки-формы (редизайн #56): обязательное заполнено —
   *  ввод собирается из самого письма, окно не нужно. */
  function runRegistration(t: WorkflowTransition) {
    if (execute.isPending || runner.isPending) return;
    const input = letterRegistrationInput(letter, methods);
    if (!input) {
      runner.run(t);
      return;
    }
    setDirectId(t.id);
    execute.mutate(
      { letterId: letter.id, transition: t, body: { form: { registration: input } } },
      {
        onSuccess: (result) => {
          setDirectId(null);
          toastLetterTransition(result, true);
        },
        onError: (error) => {
          setDirectId(null);
          if (isValidationRefusal(error)) {
            runner.run(t);
            return;
          }
          if (alreadyRegisteredNumber(error) !== null) {
            toast.error(errorMessages[ErrorCode.LETTER_ALREADY_REGISTERED]);
            // Коллега зарегистрировал письмо первым — карточка обновится.
            void queryClient.invalidateQueries({ queryKey: lettersKeys.detail(letter.id) });
            void queryClient.invalidateQueries({ queryKey: lettersKeys.transitions(letter.id) });
          }
          // Прочие ошибки тостит сам useExecuteLetterTransition.
        },
      },
    );
  }

  const renderButton = (t: WorkflowTransition, main: boolean) => {
    const running = runner.runningId === t.id || directId === t.id;
    const Icon = running ? Loader2 : transitionIcon(t);
    return (
      <button
        key={t.id}
        type="button"
        aria-busy={running || undefined}
        aria-label={t.name}
        title={`${t.name}: ${t.toStageName}`}
        onClick={() => (isRegistration(t) ? runRegistration(t) : runner.run(t))}
        className={cn(
          btn,
          main
            ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
            : 'min-w-0 shrink text-muted-foreground hover:bg-accent hover:text-foreground',
          t.blockedBy.length > 0 && 'opacity-50',
        )}
      >
        <Icon className={cn('size-4 shrink-0', running && 'animate-spin')} strokeWidth={1.75} />
        {/* Узкая левая зона: подписи сбрасываются по контейнеру ДО того, как
            flex-ряд сожмёт кнопку в огрызок. Пороги — замер суммы ширин кнопок
            бара: обе подписи влезают с ~780px контейнера, вторичная без
            «обсуждения» — с ~560px. */}
        {/* max-w-56: «Закрыть без регистрации» (самая длинная подпись маршрута)
            влезает целиком; уже — обрезка с title на самой кнопке. */}
        <span className={cn('max-w-56 min-w-0 truncate', !main && '@max-[580px]:hidden')}>
          {t.name}
        </span>
      </button>
    );
  };

  return (
    // gap-1: при типовой ширине левой зоны (1600px экрана) в бар влезают все
    // подписи маршрута без обрезки — замер живого DOM (#56 редизайн).
    <div className="flex w-full min-w-0 items-center gap-1">
      {runner.dialog}
      {closed ? (
        <span
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium',
            stageTone[letter.stage.color].chip,
          )}
        >
          {letter.stage.outcome === 'success' ? (
            <Check className="size-4" strokeWidth={2} />
          ) : (
            <X className="size-4" strokeWidth={2} />
          )}
          {letter.stage.name}
        </span>
      ) : null}
      {primary ? renderButton(primary, true) : null}
      {visible.map((t) => renderButton(t, false))}
      {/* Действия письма без смены статуса (#633, аудит В1): слот панели,
          одно — кнопкой, два и больше — первая сразу, остальные по стрелке. */}
      {actionRunner.dialog}
      {mainAction ? (
        <ProcessButtonSlot items={[actionItem(mainAction)]} main slotLabel={mainAction.name} />
      ) : null}
      {slotActions.length > 0 ? (
        <ProcessButtonSlot
          items={slotActions.map(actionItem)}
          slotLabel={processSlotLabels.actions}
        />
      ) : null}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={ui.letters.pipeline.more}
            title={ui.letters.pipeline.more}
            className={cn(
              btn,
              'px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-max min-w-44">
            {menu.map((t) => (
              <DropdownMenuItem
                key={t.id}
                title={t.toStageName}
                onSelect={() => (isRegistration(t) ? runRegistration(t) : runner.run(t))}
              >
                {t.name}
              </DropdownMenuItem>
            ))}
            {letter.access.canEdit ? (
              <>
                {menu.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={onInvite}>
                  <UserPlus className="size-3.5" />
                  {ui.letters.card.invite}
                </DropdownMenuItem>
              </>
            ) : null}
            {letter.access.canDeleteSpam ? (
              <>
                {menu.length > 0 || letter.access.canEdit ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="destructive" onSelect={onDeleteSpam}>
                  <Trash2 className="size-3.5" />
                  {ui.letters.pipeline.deleteSpam}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {transitions && transitions.length === 0 && !closed ? (
        <span className="truncate px-1 text-sm text-muted-foreground">
          {ui.letters.card.noActions}
        </span>
      ) : null}
      <span className="ml-auto" />
    </div>
  );
}
