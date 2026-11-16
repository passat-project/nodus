import { HttpResponse, http } from 'msw';
import {
  ErrorCode,
  Permission,
  ui,
  type AssistantMessage,
  type AssistantSession,
  type AssistantToolCall,
} from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';

/**
 * Моки диалога ИИ-ассистента (#895): сессии, история, отправка и ПОТОК
 * прогона (SSE в `ReadableStream`). Интерфейс проверяется тем же кодом, что
 * и на живом API: `POST` → 202 `{ runId }`, поток → дельты, строка вызова,
 * финал. Ответы демонстрационные — портал честно говорит, что данных нет.
 */

interface MockSession extends AssistantSession {
  messages: AssistantMessage[];
}

const sessions: MockSession[] = [];
const runs = new Map<string, { sessionId: string; question: string; cancelled: boolean }>();

function canUse(): boolean {
  return Boolean(useAuthStore.getState().user?.permissions.includes(Permission.ASSISTANT_USE));
}

function forbidden() {
  return HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
}

function notFound() {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Not found' }, { status: 404 });
}

const nowIso = (): string => new Date().toISOString();

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
    runs.set(runId, { sessionId: session.id, question: text, cancelled: false });
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
        send('run.started', { messageId: crypto.randomUUID(), model: 'demo/model-flash' });
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
          messageId: crypto.randomUUID(),
          text: step.text,
          reasoning: 'Выбираю действие по вопросу.',
        });
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
];
