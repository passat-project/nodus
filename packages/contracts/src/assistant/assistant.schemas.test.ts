import { describe, expect, it } from 'vitest';

import { ASSISTANT_LIMITS } from './assistant-limits.js';
import {
  assistantMessageListSchema,
  assistantMessageSchema,
  assistantRunEventDataSchema,
  assistantRunEventSchema,
  assistantRunSchema,
  assistantSessionSchema,
  assistantToolCallSchema,
  createAssistantSessionBodySchema,
  sendAssistantMessageBodySchema,
  sendAssistantMessageResponseSchema,
  TERMINAL_RUN_STATUSES,
  updateAssistantSessionBodySchema,
} from './assistant.schemas.js';

/**
 * Контракты ассистента (эпик #889, ADR-0043): форма ответов API и событий
 * SSE. Клиент разбирает поток этими схемами — расхождение здесь означает
 * «пустой ответ» в ленте, поэтому проверяем и валидные, и отклоняемые формы.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const ISO = '2026-11-17T10:00:00.000Z';

const toolCall = {
  id: UUID,
  toolId: 'tasks.list',
  title: 'Задачи: список',
  status: 'done',
  args: { scope: 'mine' },
  resultPreview: 'Задачи: 1',
  durationMs: 12,
  errorCode: null,
  href: null,
  hrefLabel: null,
};

const message = {
  id: UUID,
  role: 'assistant',
  text: 'У вас одна задача',
  reasoning: null,
  createdAt: ISO,
  runId: UUID,
  streaming: false,
  errorCode: null,
  toolCalls: [toolCall],
};

describe('assistantSessionSchema / списки (#889)', () => {
  it('сессия с датами ISO и без последнего сообщения', () => {
    const session = {
      id: UUID,
      title: 'Мои задачи',
      archived: false,
      createdAt: ISO,
      updatedAt: ISO,
      lastMessageAt: null,
      messageCount: 0,
    };
    expect(assistantSessionSchema.parse(session)).toEqual(session);
    expect(assistantSessionSchema.safeParse({ ...session, id: 'не-uuid' }).success).toBe(false);
    expect(assistantSessionSchema.safeParse({ ...session, messageCount: -1 }).success).toBe(false);
  });

  it('список сообщений: nextCursor null или строка, пустой список валиден', () => {
    expect(assistantMessageListSchema.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      assistantMessageListSchema.parse({ items: [message], nextCursor: 'cursor' }).items,
    ).toHaveLength(1);
    expect(assistantMessageListSchema.safeParse({ items: [], nextCursor: '' }).success).toBe(false);
  });
});

describe('assistantMessageSchema / toolCall (#889)', () => {
  it('сообщение ассистента с вызовом инструмента', () => {
    expect(assistantMessageSchema.parse(message)).toEqual(message);
  });

  it('роль только user/assistant: tool-результаты в ленту не попадают', () => {
    expect(assistantMessageSchema.parse({ ...message, role: 'user' }).role).toBe('user');
    expect(assistantMessageSchema.safeParse({ ...message, role: 'tool' }).success).toBe(false);
  });

  it('вызов инструмента: args — объект или null, отрицательная длительность отклоняется', () => {
    expect(assistantToolCallSchema.parse(toolCall).args).toEqual({ scope: 'mine' });
    expect(assistantToolCallSchema.parse({ ...toolCall, args: null }).args).toBeNull();
    expect(assistantToolCallSchema.safeParse({ ...toolCall, durationMs: -1 }).success).toBe(false);
    expect(assistantToolCallSchema.safeParse({ ...toolCall, status: 'queued' }).success).toBe(
      false,
    );
  });
});

describe('тела запросов (#889)', () => {
  it('создание сессии: заголовок необязателен, пустой отклоняется', () => {
    expect(createAssistantSessionBodySchema.parse({})).toEqual({});
    expect(createAssistantSessionBodySchema.parse({ title: 'Диалог' })).toEqual({
      title: 'Диалог',
    });
    expect(createAssistantSessionBodySchema.safeParse({ title: '' }).success).toBe(false);
    expect(createAssistantSessionBodySchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });

  it('правка сессии: нужно хотя бы одно поле (title или archived)', () => {
    expect(updateAssistantSessionBodySchema.parse({ archived: true })).toEqual({ archived: true });
    expect(updateAssistantSessionBodySchema.parse({ title: '  Новое  ' }).title).toBe('Новое');
    expect(updateAssistantSessionBodySchema.safeParse({}).success).toBe(false);
  });

  it('сообщение: текст обрезается по пробелам, лимит промпта соблюдается', () => {
    expect(sendAssistantMessageBodySchema.parse({ text: '  Привет  ' }).text).toBe('Привет');
    expect(sendAssistantMessageBodySchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(
      sendAssistantMessageBodySchema.safeParse({
        text: 'x'.repeat(ASSISTANT_LIMITS.maxPromptChars + 1),
      }).success,
    ).toBe(false);
  });

  it('контекст экрана: допустимые виды карточек и uuid', () => {
    const body = sendAssistantMessageBodySchema.parse({
      text: 'Что в этой задаче?',
      context: { moduleId: 'tasks', cardKind: 'task', cardId: UUID },
    });
    expect(body.context).toEqual({ moduleId: 'tasks', cardKind: 'task', cardId: UUID });
    expect(
      sendAssistantMessageBodySchema.safeParse({
        text: 'x',
        context: { cardKind: 'employee' },
      }).success,
    ).toBe(false);
  });

  it('ответ отправки: runId и messageId — uuid', () => {
    expect(sendAssistantMessageResponseSchema.parse({ runId: UUID, messageId: UUID })).toEqual({
      runId: UUID,
      messageId: UUID,
    });
    expect(
      sendAssistantMessageResponseSchema.safeParse({ runId: 'x', messageId: UUID }).success,
    ).toBe(false);
  });
});

describe('assistantRunSchema: статусы и терминальные состояния (#889)', () => {
  const run = {
    id: UUID,
    sessionId: UUID,
    status: 'running',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    inputTokens: null,
    outputTokens: null,
    errorCode: null,
    errorMessage: null,
    startedAt: ISO,
    finishedAt: null,
    createdAt: ISO,
  };

  it('принимает все статусы прогона и отклоняет неизвестный', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'cancelled'] as const) {
      expect(assistantRunSchema.parse({ ...run, status }).status).toBe(status);
    }
    expect(assistantRunSchema.safeParse({ ...run, status: 'streaming' }).success).toBe(false);
  });

  it('терминальные статусы — ровно завершение, ошибка и отмена', () => {
    expect(TERMINAL_RUN_STATUSES).toEqual(['completed', 'failed', 'cancelled']);
    expect(TERMINAL_RUN_STATUSES).not.toContain('running');
  });
});

describe('assistantRunEventDataSchema: события SSE (#889)', () => {
  it('delta-события несут текст', () => {
    expect(assistantRunEventDataSchema.parse({ type: 'message.delta', text: 'при' })).toEqual({
      type: 'message.delta',
      text: 'при',
    });
    expect(assistantRunEventDataSchema.parse({ type: 'reasoning.delta', text: 'думаю' }).type).toBe(
      'reasoning.delta',
    );
  });

  it('старт прогона и вызов инструмента', () => {
    expect(
      assistantRunEventDataSchema.parse({ type: 'run.started', messageId: UUID, model: null }),
    ).toMatchObject({ type: 'run.started', model: null });
    const started = assistantRunEventDataSchema.parse({
      type: 'tool.started',
      toolCallId: UUID,
      toolId: 'tasks.list',
      title: 'Задачи: список',
      args: null,
    });
    expect(started.type).toBe('tool.started');
    const finished = assistantRunEventDataSchema.parse({
      type: 'tool.finished',
      toolCallId: UUID,
      toolId: 'tasks.list',
      status: 'error',
      resultPreview: null,
      durationMs: null,
      errorCode: 'FORBIDDEN',
      href: null,
      hrefLabel: null,
    });
    expect(finished).toMatchObject({ type: 'tool.finished', status: 'error' });
  });

  it('финал, ошибка и отмена', () => {
    expect(
      assistantRunEventDataSchema.parse({
        type: 'message.completed',
        messageId: UUID,
        text: 'Ответ',
        reasoning: null,
      }).type,
    ).toBe('message.completed');
    expect(
      assistantRunEventDataSchema.parse({
        type: 'run.completed',
        inputTokens: 10,
        outputTokens: 20,
      }),
    ).toMatchObject({ type: 'run.completed', outputTokens: 20 });
    expect(
      assistantRunEventDataSchema.safeParse({ type: 'run.error', code: '', message: 'x' }).success,
    ).toBe(false);
    expect(
      assistantRunEventDataSchema.parse({
        type: 'run.error',
        code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
        message: 'Сеть',
        retryable: true,
      }),
    ).toMatchObject({ retryable: true });
    expect(assistantRunEventDataSchema.parse({ type: 'run.cancelled' }).type).toBe('run.cancelled');
  });

  it('неизвестный тип события отклоняется — клиент не рисует неизвестное', () => {
    expect(assistantRunEventDataSchema.safeParse({ type: 'run.exploded' }).success).toBe(false);
  });

  it('событие потока: seq, тип, данные и время', () => {
    const event = { seq: 7, type: 'message.delta', data: { text: 'при' }, createdAt: ISO };
    expect(assistantRunEventSchema.parse(event)).toEqual(event);
    expect(assistantRunEventSchema.safeParse({ ...event, seq: -1 }).success).toBe(false);
  });
});
