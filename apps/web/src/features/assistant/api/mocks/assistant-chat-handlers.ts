import { HttpResponse, http } from 'msw';
import {
  ErrorCode,
  ui,
  type AssistantMessage,
  type AssistantSession,
  type AssistantToolCall,
} from '@nodus/contracts';

import { assistantActionHandlers } from './assistant-action-handlers.js';
import {
  batchStates,
  demoAction,
  refreshBatch,
  runs,
  sessionOf,
  sessions,
  type MockSession,
} from './assistant-chat-store.js';
import { canUse, forbidden, notFound, nowIso } from './assistant-mock-http.js';

/**
 * Моки диалога ИИ-ассистента (#895): сессии, история, отправка и ПОТОК
 * прогона (SSE в `ReadableStream`). Интерфейс проверяется тем же кодом, что
 * и на живом API: `POST` → 202 `{ runId }`, поток → дельты, строка вызова,
 * финал. Ответы демонстрационные — портал честно говорит, что данных нет.
 *
 * Карточки действий и пачка (#916): на вопрос с глаголом действия прогон
 * готовит одну демо-карточку; решения исполняются теми же маршрутами, что на
 * API, и закрывают пачку продолжением — чтобы весь круговорот был виден на
 * dev-сервере с моками (песочница всегда non-mock).
 */

function toDto(session: MockSession): AssistantSession {
  return {
    id: session.id,
    title: session.title,
    archived: session.archived,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessageAt: session.lastMessageAt,
    messageCount: session.messageCount,
  };
}

/** Демонстрационный ход: инструмент + текст, честно про демо-режим. */
function demoStep(question: string): { text: string; tool: AssistantToolCall } {
  const lower = question.toLowerCase();
  const tools: AssistantToolCall = {
    id: crypto.randomUUID(),
    toolId: 'context.get',
    title: 'Контекст экрана',
    status: 'done',
    args: {},
    resultPreview: 'Демо-режим: данные портала не запрашивались',
    durationMs: 6,
    errorCode: null,
    href: null,
    hrefLabel: null,
  };
  if (/просроч|дедлайн|горит/.test(lower)) {
    return {
      text: 'В демонстрационном режиме данных портала нет. На рабочем портале я вызову журнал задач и покажу просроченные поручения со сроками, стадиями и исполнителями.',
      tool: {
        ...tools,
        toolId: 'tasks.list',
        title: 'Задачи: список',
        args: { scope: 'mine', overdue: true },
      },
    };
  }
  if (/письм|контрагент|корреспонденц/.test(lower)) {
    return {
      text: 'В демонстрационном режиме реестр писем пуст. На рабочем портале я найду письма по корреспонденту: номер, тема, стадия, срок ответа; вложения — только описью, содержимое файлов не читается.',
      tool: {
        ...tools,
        toolId: 'letters.list',
        title: 'Письма: реестр',
        args: { box: 'incoming' },
      },
    };
  }
  return {
    text: 'Это демонстрационный режим ИИ-ассистента: провайдер моделей не подключён, данные портала не запрашиваются. На рабочем портале отвечу по задачам, письмам, проектам и беседам в пределах ваших прав.',
    tool: tools,
  };
}

export const assistantChatHandlers = [
  http.get('/api/v1/assistant/sessions', () => {
    if (!canUse()) return forbidden();
    return HttpResponse.json({
      items: sessions
        .map(toDto)
        .sort((a, b) =>
          (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
        ),
      nextCursor: null,
    });
  }),

  http.post('/api/v1/assistant/sessions', () => {
    if (!canUse()) return forbidden();
    const session: MockSession = {
      id: crypto.randomUUID(),
      title: ui.assistant.newChat,
      archived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastMessageAt: null,
      messageCount: 0,
      messages: [],
    };
    sessions.unshift(session);
    return HttpResponse.json(toDto(session));
  }),

  http.patch('/api/v1/assistant/sessions/:id', async ({ params, request }) => {
    if (!canUse()) return forbidden();
    const session = sessions.find((item) => item.id === params.id);
    if (!session) return notFound();
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    if (body.title) session.title = body.title;
    return HttpResponse.json(toDto(session));
  }),

  http.get('/api/v1/assistant/sessions/:id/messages', ({ params }) => {
    if (!canUse()) return forbidden();
    const session = sessions.find((item) => item.id === params.id);
    if (!session) return notFound();
    return HttpResponse.json({ items: session.messages, nextCursor: null });
  }),

  http.post('/api/v1/assistant/sessions/:id/messages', async ({ params, request }) => {
    if (!canUse()) return forbidden();
    const session = sessions.find((item) => item.id === params.id);
    if (!session) return notFound();
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const text = (body.text ?? '').trim();
    if (!text) {
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Empty message' },
        { status: 400 },
      );
    }
    const runId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    // Новое сообщение = «Продолжить сейчас»: открытые пачки закрываются для
    // автопродолжения, сами карточки остаются рабочими (#916, п. 4).
    for (const item of session.messages) {
      if (item.actionBatch?.state === 'open') {
        batchStates.set(item.id, 'closed');
        refreshBatch(item);
      }
    }
    runs.set(runId, { sessionId: session.id, question: text, cancelled: false, action: null });
    session.messages.push({
      id: messageId,
      role: 'user',
      text,
      reasoning: null,
      createdAt: nowIso(),
      runId,
      streaming: false,
      errorCode: null,
      toolCalls: [],
      actions: [],
      actionBatch: null,
    });
    if (session.title === ui.assistant.newChat) session.title = text.slice(0, 80);
    session.lastMessageAt = nowIso();
    session.messageCount = session.messages.length;
    return HttpResponse.json({ runId, messageId }, { status: 202 });
  }),

  http.get('/api/v1/assistant/runs/:runId/stream', ({ params }) => {
    if (!canUse()) return forbidden();
    const runId = String(params.runId);
    const run = runs.get(runId);
    const step = demoStep(run?.question ?? '');
    const session = run ? sessionOf(run.sessionId) : undefined;
    const assistantMessageId = crypto.randomUUID();
    const encoder = new TextEncoder();
    const state = { seq: 0 };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (type: string, data: Record<string, unknown>) => {
          state.seq += 1;
          controller.enqueue(
            encoder.encode(
              `id: ${state.seq}\ntype: ${type}\ndata: ${JSON.stringify({ ...data, type, seq: state.seq })}\n\n`,
            ),
          );
        };
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        send('run.started', { messageId: assistantMessageId, model: 'demo/model-flash' });
        for (const word of 'Выбираю действие по вопросу.'.split(' ')) {
          if (run?.cancelled) {
            send('run.cancelled', {});
            controller.close();
            return;
          }
          send('reasoning.delta', { text: `${word} ` });
          await wait(24);
        }
        send('tool.started', {
          toolCallId: step.tool.id,
          toolId: step.tool.toolId,
          title: step.tool.title,
          args: step.tool.args,
        });
        await wait(180);
        send('tool.finished', {
          toolCallId: step.tool.id,
          toolId: step.tool.toolId,
          status: 'done',
          resultPreview: step.tool.resultPreview,
          durationMs: 18,
          errorCode: null,
          href: null,
          hrefLabel: null,
        });
        // Карточка пачки (#916): только на вопрос с глаголом действия.
        const action = demoAction(run?.question ?? '');
        if (action) {
          action.messageId = assistantMessageId;
          if (run) run.action = action;
          send('action.proposed', { action });
          await wait(120);
        }
        for (const word of step.text.split(' ')) {
          if (run?.cancelled) {
            send('run.cancelled', {});
            controller.close();
            return;
          }
          send('message.delta', { text: `${word} ` });
          await wait(18);
        }
        send('message.completed', {
          messageId: assistantMessageId,
          text: step.text,
          reasoning: 'Выбираю действие по вопросу.',
        });
        // Ответ сохраняется в историю, как на API: карточки живут в снимке
        // сообщения, решения обновляют его же.
        if (session && !run?.cancelled) {
          const message: AssistantMessage = {
            id: assistantMessageId,
            role: 'assistant',
            text: step.text,
            reasoning: 'Выбираю действие по вопросу.',
            createdAt: nowIso(),
            runId,
            streaming: false,
            errorCode: null,
            toolCalls: [step.tool],
            actions: action ? [action] : [],
            actionBatch: null,
          };
          if (action) refreshBatch(message);
          session.messages.push(message);
          session.lastMessageAt = nowIso();
          session.messageCount = session.messages.length;
        }
        send('run.completed', { inputTokens: 120, outputTokens: 80 });
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  }),

  http.get('/api/v1/assistant/runs/:runId', ({ params }) => {
    if (!canUse()) return forbidden();
    const run = runs.get(String(params.runId));
    if (!run) return notFound();
    return HttpResponse.json({
      id: String(params.runId),
      sessionId: run.sessionId,
      status: run.cancelled ? 'cancelled' : 'completed',
      model: 'demo/model-flash',
      inputTokens: 120,
      outputTokens: 80,
      errorCode: null,
      errorMessage: null,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      createdAt: nowIso(),
    });
  }),

  http.post('/api/v1/assistant/runs/:runId/cancel', ({ params }) => {
    if (!canUse()) return forbidden();
    const runId = String(params.runId);
    const run = runs.get(runId);
    if (run) run.cancelled = true;
    return HttpResponse.json({
      id: runId,
      sessionId: run?.sessionId ?? '',
      status: 'cancelled',
      model: 'demo/model-flash',
      inputTokens: null,
      outputTokens: null,
      errorCode: null,
      errorMessage: null,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      createdAt: nowIso(),
    });
  }),

  ...assistantActionHandlers,
];
