import { useState } from 'react';
import { CheckCheck, XCircle } from 'lucide-react';
import { ui, type AssistantActionBatch } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { useAssistantBatchDecision } from '../api/assistant-actions-api.js';

const strings = ui.assistant;

/**
 * Пачка карточек одного хода (#916): прогресс и решения «все сразу».
 * Одиночная карточка полосу не получает — у неё свои кнопки. Решение
 * применяется к каждой карточке теми же путями, что и одиночные (аудит,
 * идемпотентность), после последней сервер запускает продолжение.
 */
export function AssistantActionBatchBar({
  messageId,
  batch,
  sessionId,
  className,
}: {
  messageId: string;
  batch: AssistantActionBatch | null;
  sessionId: string | null;
  className?: string;
}) {
  // Серверной пачки нет (байпас/история до пачек) или карточка одна:
  // полосы нет — у одиночной карточки свои кнопки.
  if (!batch || batch.total < 2) return null;
  return (
    <BatchBarView messageId={messageId} batch={batch} sessionId={sessionId} className={className} />
  );
}

function BatchBarView({
  messageId,
  batch,
  sessionId,
  className,
}: {
  messageId: string;
  batch: AssistantActionBatch;
  sessionId: string | null;
  className?: string;
}) {
  const executeAll = useAssistantBatchDecision(sessionId, 'execute-all');
  const cancelAll = useAssistantBatchDecision(sessionId, 'cancel-all');
  const pending = executeAll.isPending || cancelAll.isPending;
  const open = batch.state === 'open';
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-2 py-1.5 text-label text-muted-foreground',
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {strings.batchTitle} · {strings.batchProgress} {batch.decided} {strings.batchOf}{' '}
        {batch.total}
        {error ? <span className="text-destructive"> · {error}</span> : null}
      </span>
      {open ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-label"
            disabled={pending}
            onClick={() => {
              setError(null);
              executeAll.mutate(messageId, {
                onError: () => setError(strings.batchActionError),
              });
            }}
          >
            <CheckCheck className="size-3" />
            {strings.batchExecuteAll}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-label text-muted-foreground"
            disabled={pending}
            onClick={() => {
              setError(null);
              cancelAll.mutate(messageId, {
                onError: () => setError(strings.batchActionError),
              });
            }}
          >
            <XCircle className="size-3" />
            {strings.batchCancelAll}
          </Button>
        </>
      ) : (
        <span className="text-badge opacity-80">
          {batch.state === 'continued'
            ? strings.batchContinued
            : batch.pending > 0
              ? `${strings.batchClosed} · ${batch.pending} ${strings.batchStillPending}`
              : strings.batchAllDone}
        </span>
      )}
    </div>
  );
}
