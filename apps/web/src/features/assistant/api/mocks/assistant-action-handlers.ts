import { HttpResponse, http } from 'msw';
import { canUse, conflict, forbidden, notFound, nowIso } from './assistant-mock-http.js';
import {
  afterDecision,
  batchStates,
  findAction,
  findBatch,
  refreshBatch,
  runs,
  startContinuation,
} from './assistant-chat-store.js';

/**
 * Моки решений по карточкам и пачке (#916): те же маршруты и конверты, что
 * на API — execute/cancel/undo, execute-all/cancel-all, continue. Демо не
 * пишет в портал: меняется только состояние карточки, итог это признаёт.
 */

export const assistantActionHandlers = [
  /* ===== Карточки действий и пачка (#916): те же маршруты и конверты, что на API ===== */

  http.post('/api/v1/assistant/actions/:id/execute', ({ params }) => {
    if (!canUse()) return forbidden();
    const found = findAction(null, (action) => action.id === params.id);
    if (!found) return notFound();
    const { session, message, action } = found;
    if (action.state === 'proposed' || action.state === 'failed') {
      action.state = 'executed';
      action.executedAt = nowIso();
      action.resultPreview = 'Демо: действие выполнено, данные портала не менялись';
    }
    return HttpResponse.json({ action, continuationRunId: afterDecision(session, message) });
  }),

  http.post('/api/v1/assistant/actions/:id/cancel', ({ params }) => {
    if (!canUse()) return forbidden();
    const found = findAction(null, (action) => action.id === params.id);
    if (!found) return notFound();
    const { session, message, action } = found;
    if (action.state === 'proposed' || action.state === 'failed') action.state = 'cancelled';
    return HttpResponse.json({ action, continuationRunId: afterDecision(session, message) });
  }),

  http.post('/api/v1/assistant/actions/:id/undo', ({ params }) => {
    if (!canUse()) return forbidden();
    const found = findAction(null, (action) => action.id === params.id);
    if (!found) return notFound();
    const { action } = found;
    if (action.state === 'executed' && action.undoable) {
      action.state = 'undone';
      action.undoneAt = nowIso();
    }
    return HttpResponse.json(action);
  }),

  http.post('/api/v1/assistant/messages/:id/actions/execute-all', ({ params }) => {
    if (!canUse()) return forbidden();
    const batch = findBatch(String(params.id));
    if (!batch) return notFound();
    const { session, message } = batch;
    for (const action of message.actions) {
      if (action.state === 'proposed' || action.state === 'failed') {
        action.state = 'executed';
        action.executedAt = nowIso();
        action.resultPreview = 'Демо: действие выполнено, данные портала не менялись';
      }
    }
    return HttpResponse.json({
      actions: message.actions,
      continuationRunId: afterDecision(session, message),
    });
  }),

  http.post('/api/v1/assistant/messages/:id/actions/cancel-all', ({ params }) => {
    if (!canUse()) return forbidden();
    const batch = findBatch(String(params.id));
    if (!batch) return notFound();
    const { session, message } = batch;
    for (const action of message.actions) {
      if (action.state === 'proposed' || action.state === 'failed') action.state = 'cancelled';
    }
    return HttpResponse.json({
      actions: message.actions,
      continuationRunId: afterDecision(session, message),
    });
  }),

  http.post('/api/v1/assistant/messages/:id/continue', ({ params }) => {
    if (!canUse()) return forbidden();
    const batch = findBatch(String(params.id));
    if (!batch) return notFound();
    const { session, message } = batch;
    const state = batchStates.get(message.id) ?? 'open';
    // Повторный клик после автопродолжения — тот же прогон, без дубля.
    if (state === 'continued')
      return HttpResponse.json({ runId: startContinuation(session, message.id) });
    if (state === 'closed') return conflict('Пачка уже закрыта: агент ответит на сообщение');
    batchStates.set(message.id, 'closed');
    refreshBatch(message);
    const runId = crypto.randomUUID();
    runs.set(runId, { sessionId: session.id, question: 'итог', cancelled: false, action: null });
    return HttpResponse.json({ runId });
  }),
];
