import { ArrowDown, Loader2 } from 'lucide-react';
import { ui, type AssistantMessage } from '@nodus/contracts';

import { useContinueAssistantBatch } from '../api/assistant-actions-api.js';
import { useState } from 'react';

const strings = ui.assistant;

/** Открытая пачка с ожидающими карточками — самая свежая в ленте. */
export function findOpenBatch(messages: readonly AssistantMessage[]): AssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const batch = message.actionBatch;
    if (batch && batch.state === 'open' && batch.pending > 0) return message;
  }
  return null;
}

/**
 * Липкая строка пачки (#916) над композером: сотрудник видит, что часть
 * карточек ещё ждёт решения, может вернуться к ним или попросить агента
 * продолжить с уже принятыми. Пока агент отвечает — строки нет (он и так
 * на виду), после продолжения пачка закрыта и строка исчезает.
 */
export function AssistantBatchStrip({
  messages,
  sessionId,
  busy,
}: {
  messages: readonly AssistantMessage[];
  sessionId: string | null;
  busy: boolean;
}) {
  const message = findOpenBatch(messages);
  if (!message?.actionBatch || busy) return null;
  // Хук мутации живёт в дочернем компоненте: без открытой пачки строка не
  // рендерится вовсе и не требует QueryClient (тесты шапки окна).
  return <BatchStripView message={message} sessionId={sessionId} />;
}

function BatchStripView({
  message,
  sessionId,
}: {
  message: AssistantMessage;
  sessionId: string | null;
}) {
  const continuation = useContinueAssistantBatch(sessionId);
  const [error, setError] = useState<string | null>(null);
  const { decided, total } = message.actionBatch!;

  function toCards() {
    document
      .querySelector(`[data-assistant-batch="${message!.id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function continueNow() {
    setError(null);
    continuation.mutate(message!.id, {
      onError: () => setError(strings.batchContinueError),
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card/60 px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-label text-muted-foreground">
        {strings.batchProgress} {decided} {strings.batchOf} {total}
        {error ? <span className="text-destructive"> · {error}</span> : null}
      </span>
      <button
        type="button"
        onClick={toCards}
        className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-foreground"
      >
        <ArrowDown className="size-3" />
        {strings.batchToCards}
      </button>
      <button
        type="button"
        onClick={continueNow}
        disabled={continuation.isPending}
        title={strings.batchContinuePending}
        className="inline-flex items-center gap-1 text-label font-medium text-primary hover:underline disabled:opacity-60"
      >
        {continuation.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
        {continuation.isPending ? strings.batchWaiting : strings.batchContinue}
      </button>
    </div>
  );
}
