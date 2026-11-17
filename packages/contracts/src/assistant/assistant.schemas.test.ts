import { describe, expect, it } from 'vitest';

import { ASSISTANT_LIMITS } from './assistant-limits.js';
import {
  assistantActionSchema,
  assistantMessageListSchema,
  assistantMessageSchema,
  assistantRunEventDataSchema,
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
  actions: [],
  actionBatch: null,
};

/** Карточка действия Ф2 (ADR-0048): подтверждение записи в портал. */
const action = {
  id: UUID,
  messageId: null,
  toolId: 'tasks.create',
  title: 'Создать задачу',
  summary: 'Задача «Смета»',
  fields: [{ label: 'Название', value: 'Смета' }],
  consequences: 'Появится в портале',
  undoable: true,
  automatic: false,
  state: 'proposed',
  resultPreview: null,
  href: null,
  hrefLabel: null,
  errorCode: null,
  createdAt: ISO,
  executedAt: null,
  undoneAt: null,
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

describe('карточка действия и байпас (Ф2, #899, ADR-0048)', () => {
  it('карточка: поля-столбиком, состояния, результат и отмена', () => {
    expect(assistantActionSchema.parse(action)).toEqual(action);
    expect(
      assistantActionSchema.parse({ ...action, state: 'executed', resultPreview: 'Готово' }).state,
    ).toBe('executed');
    expect(assistantActionSchema.safeParse({ ...action, state: 'unknown' }).success).toBe(false);
    expect(
      assistantActionSchema.safeParse({ ...action, fields: [{ label: '', value: 'x' }] }).success,
    ).toBe(false);
  });

  it('сообщение несёт карточки действий', () => {
    const withAction = { ...message, actions: [action] };
    expect(assistantMessageSchema.parse(withAction).actions).toHaveLength(1);
  });

  it('события действий разбираются клиентом потока', () => {
    for (const type of [
      'action.proposed',
      'action.executed',
      'action.cancelled',
      'action.failed',
      'action.undone',
    ] as const) {
      expect(assistantRunEventDataSchema.parse({ type, action })).toMatchObject({ type });
    }
  });

  it('байпас — флаг отправки: необязательный, без него тело прежнее', () => {
    expect(sendAssistantMessageBodySchema.parse({ text: 'создай задачу' })).toEqual({
      text: 'создай задачу',
    });
    expect(
      sendAssistantMessageBodySchema.parse({ text: 'создай задачу', bypass: true }).bypass,
    ).toBe(true);
  });
});
