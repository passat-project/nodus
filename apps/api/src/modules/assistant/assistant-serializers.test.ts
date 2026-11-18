import { describe, expect, it } from 'vitest';

import { toMessageDto, toRunDto, toSessionDto, toToolCallDto } from './assistant.serializers.js';
import type { MessageRow, RunRow, SessionRow, ToolCallRow } from './assistant.repository.js';

/**
 * DTO-сериализаторы ассистента (#893): строки БД → контракты. Форма ответа
 * API не должна зависеть от схемы БД, поэтому здесь зафиксированы все
 * нормализации: пустой заголовок, «печатает» только у живого прогона,
 * неизвестный статус — `queued`.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-17T10:00:00.000Z');

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    title: '',
    archivedAt: null,
    lastMessageAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    messageCount: 0,
    ...overrides,
  };
}

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: MESSAGE_ID,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    role: 'assistant',
    text: 'Ответ',
    reasoning: null,
    errorCode: null,
    createdAt: NOW,
    runStatus: 'running',
    toolCalls: [],
    actions: [],
    actionBatch: null,
    ...overrides,
  };
}

function toolCallRow(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    id: 'call-1',
    runId: RUN_ID,
    messageId: MESSAGE_ID,
    seq: 1,
    toolId: 'tasks.list',
    title: '',
    status: 'done',
    args: { scope: 'mine' },
    resultPreview: 'Задачи: 1',
    durationMs: 12,
    errorCode: null,
    href: null,
    hrefLabel: null,
    ...overrides,
  };
}

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
    status: 'running',
    continuationOfMessageId: null,
    providerId: null,
    modelId: 'm1',
    inputTokens: null,
    outputTokens: null,
    contextTokens: null,
    errorCode: null,
    errorMessage: null,
    startedAt: NOW,
    finishedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('сериализаторы: строки БД → контракты (#893)', () => {
  it('сессия: пустой заголовок — «Новый диалог», архив и даты по ISO', () => {
    expect(toSessionDto(sessionRow())).toMatchObject({
      title: 'Новый диалог',
      archived: false,
      lastMessageAt: null,
      createdAt: NOW.toISOString(),
    });
    expect(
      toSessionDto(sessionRow({ title: '  Задачи ', archivedAt: NOW, lastMessageAt: NOW })),
    ).toMatchObject({ title: 'Задачи', archived: true, lastMessageAt: NOW.toISOString() });
  });

  it('вызов инструмента: статусы done/error/running, подпись и args', () => {
    expect(toToolCallDto(toolCallRow())).toMatchObject({ status: 'done', title: 'tasks.list' });
    expect(toToolCallDto(toolCallRow({ status: 'error', title: 'Задачи' })).status).toBe('error');
    expect(toToolCallDto(toolCallRow({ status: 'queued' })).status).toBe('running');
    expect(toToolCallDto(toolCallRow({ args: ['не', 'объект'] })).args).toBeNull();
    expect(toToolCallDto(toolCallRow({ args: null })).args).toBeNull();
  });

  it('сообщение: «печатает» только у живого прогона, роль нормализуется', () => {
    expect(toMessageDto(messageRow())).toMatchObject({ streaming: true, role: 'assistant' });
    expect(toMessageDto(messageRow({ runStatus: 'queued' })).streaming).toBe(true);
    expect(toMessageDto(messageRow({ runStatus: 'completed' })).streaming).toBe(false);
    expect(toMessageDto(messageRow({ runStatus: null })).streaming).toBe(false);
    expect(toMessageDto(messageRow({ role: 'user' })).role).toBe('user');
    expect(toMessageDto(messageRow({ role: 'system' })).role).toBe('assistant');
  });

  it('прогон: неизвестный статус — queued, даты в ISO', () => {
    expect(toRunDto(runRow())).toMatchObject({
      status: 'running',
      model: 'm1',
      contextTokens: null,
      startedAt: NOW.toISOString(),
      finishedAt: null,
    });
    expect(toRunDto(runRow({ contextTokens: 321 })).contextTokens).toBe(321);
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(toRunDto(runRow({ status })).status).toBe(status);
    }
    expect(toRunDto(runRow({ status: 'weird' })).status).toBe('queued');
  });
});
