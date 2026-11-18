import { useState } from 'react';
import { ArrowUpRight, Check, Loader2, RotateCcw, ShieldCheck, Undo2, Zap } from 'lucide-react';
import { ui, type AssistantAction } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import {
  useCancelAssistantAction,
  useExecuteAssistantAction,
  useUndoAssistantAction,
} from '../api/assistant-actions-api.js';
import { openCardFromHref } from './assistant-tool-rows.js';

const strings = ui.assistant;

/**
 * Карточка действия (Ф2, ADR-0048): «что будет сделано» до записи в портал.
 * Пока сотрудник не нажал «Выполнить» (или не включён байпас), в портале
 * ничего не меняется. После выполнения — результат и ссылка на сущность;
 * где API позволяет — «Отменить» (созданное удаляется).
 */
export function AssistantActionCard({
  action,
  sessionId,
}: {
  action: AssistantAction;
  sessionId: string | null;
}) {
  const execute = useExecuteAssistantAction(sessionId);
  const cancel = useCancelAssistantAction(sessionId);
  const undo = useUndoAssistantAction(sessionId);
  const [error, setError] = useState<string | null>(null);
  const pending = execute.isPending || cancel.isPending || undo.isPending;
  const proposed = action.state === 'proposed';
  const failed = action.state === 'failed';
  const executed = action.state === 'executed';

  function decide(kind: 'execute' | 'cancel' | 'undo') {
    const mutation = kind === 'execute' ? execute : kind === 'undo' ? undo : cancel;
    setError(null);
    mutation.mutate(action.id, {
      onError: () =>
        setError(
          kind === 'execute'
            ? strings.actionExecuteError
            : kind === 'undo'
              ? strings.actionUndoError
              : strings.actionCancelError,
        ),
    });
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-card px-3 py-2.5 shadow-xs',
        proposed && 'border-primary/40',
        failed && 'border-destructive/40',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
            action.automatic ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {action.automatic ? (
            <Zap className="size-3.5" strokeWidth={1.75} />
          ) : (
            <ShieldCheck className="size-3.5" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-label font-semibold text-foreground">
              {action.title}
            </span>
            <ActionStateBadge action={action} />
          </div>
          <p className="mt-0.5 text-label text-foreground">{action.summary}</p>
        </div>
      </div>

      {action.fields.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-2 py-1.5">
          {action.fields.map((field) => (
            <div key={`${field.label}:${field.value}`} className="contents">
              <dt className="text-badge text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 break-words text-badge text-foreground">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {action.resultPreview && (executed || failed || action.state === 'undone') ? (
        <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-2 py-1.5 text-badge leading-relaxed text-muted-foreground">
          {action.resultPreview}
        </p>
      ) : (
        <p className="mt-1.5 text-badge leading-relaxed text-muted-foreground">
          {action.consequences}
        </p>
      )}

      {error ? <p className="mt-1 text-badge text-destructive">{error}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {proposed || failed ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2.5 text-label"
              disabled={pending}
              onClick={() => decide('execute')}
            >
              {execute.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : failed ? (
                <RotateCcw className="size-3" />
              ) : (
                <Check className="size-3" />
              )}
              {failed ? strings.actionRetry : strings.actionExecute}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-label text-muted-foreground"
              disabled={pending}
              onClick={() => decide('cancel')}
            >
              {strings.actionCancel}
            </Button>
          </>
        ) : null}

        {executed && action.href ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 min-w-0 max-w-full justify-start gap-1 px-2 text-label"
            onClick={() => openCardFromHref(action.href!)}
          >
            <ArrowUpRight className="size-3 shrink-0 text-primary" />
            <span className="min-w-0 truncate">
              {strings.open}
              {action.hrefLabel ? `: ${action.hrefLabel}` : ''}
            </span>
          </Button>
        ) : null}

        {executed && action.undoable ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-label text-muted-foreground"
            disabled={pending}
            onClick={() => decide('undo')}
          >
            {undo.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Undo2 className="size-3" />
            )}
            {strings.actionUndo}
          </Button>
        ) : null}

        {action.state === 'executing' ? (
          <span className="flex items-center gap-1 text-label text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {strings.actionExecuting}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Состояние карточки человеческой пометкой (без «машинных» кодов). */
function ActionStateBadge({ action }: { action: AssistantAction }) {
  const style = 'shrink-0 rounded-md px-1.5 py-0.5 text-badge font-medium';
  switch (action.state) {
    case 'executed':
      return (
        <span className={cn(style, 'bg-primary/10 text-primary')}>
          {action.automatic ? strings.actionExecutedAuto : strings.actionExecuted}
        </span>
      );
    case 'failed':
      return (
        <span className={cn(style, 'bg-destructive/10 text-destructive')}>
          {strings.actionFailed}
        </span>
      );
    case 'cancelled':
      return (
        <span className={cn(style, 'bg-muted text-muted-foreground')}>
          {strings.actionCancelled}
        </span>
      );
    case 'undone':
      return (
        <span className={cn(style, 'bg-muted text-muted-foreground')}>{strings.actionUndone}</span>
      );
    case 'executing':
      return (
        <span className={cn(style, 'bg-muted text-muted-foreground')}>
          {strings.actionExecuting}
        </span>
      );
    default:
      return (
        <span className={cn(style, 'bg-primary/10 text-primary')}>{strings.actionProposed}</span>
      );
  }
}
