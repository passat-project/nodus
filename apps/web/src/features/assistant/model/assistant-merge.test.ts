import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@nodus/contracts';

import { mergeLiveMessage } from './assistant-merge.js';
import type { AssistantLiveRun } from './assistant-store.js';

/**
 * Лента ассистента (#895): вопрос сотрудника виден сразу (I4), живой ответ
 * печатается из потока, а сохранившиеся строки истории вытесняют буфер по
 * id — дублей в окне нет.
 */

function baseLive(patch: Partial<AssistantLiveRun> = {}): AssistantLiveRun {
  return {
    runId: 'run-1',
    sessionId: 's-1',
    messageId: null,
    userText: 'Что у меня просрочено?',
    userMessageId: 'user-1',
    startedAt: Date.UTC(2026, 10, 17, 9, 0, 0),
    text: '',
    reasoning: '',
    tools: [],
    actions: [],
    status: 'running',
    errorCode: null,
    errorMessage: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    ...patch,
  };
}

function message(patch: Partial<AssistantMessage>): AssistantMessage {
  return {
    id: 'm',
    role: 'assistant',
    text: '',
    reasoning: null,
    createdAt: new Date(Date.UTC(2026, 10, 17, 9, 0, 0)).toISOString(),
    runId: 'run-1',
    streaming: false,
    errorCode: null,
    toolCalls: [],
    actions: [],
    ...patch,
  };
}

describe('mergeLiveMessage', () => {
  it('вопрос сотрудника появляется сразу, пузырь ответа — следом', () => {
    const merged = mergeLiveMessage([], baseLive(), 's-1');
    expect(merged.map((item) => [item.role, item.text])).toEqual([
      ['user', 'Что у меня просрочено?'],
      ['assistant', ''],
    ]);
  });

  it('сохранённый вопрос вытесняет синтетический — без дубля', () => {
    const history = [message({ id: 'user-1', role: 'user', text: 'Что у меня просрочено?' })];
    const merged = mergeLiveMessage(history, baseLive(), 's-1');
    expect(merged.filter((item) => item.role === 'user')).toHaveLength(1);
    expect(merged.at(-1)?.role).toBe('assistant');
  });

  it('серверный ответ той же строки не дублируется живым пузырём', () => {
    const history = [
      message({ id: 'user-1', role: 'user', text: 'Что у меня просрочено?' }),
      message({ id: 'answer-1', text: 'Просрочена одна задача.' }),
    ];
    const merged = mergeLiveMessage(
      history,
      baseLive({ messageId: 'answer-1', text: 'Просрочена одна задача.', status: 'done' }),
      's-1',
    );
    expect(merged.filter((item) => item.role === 'assistant')).toHaveLength(1);
  });

  it('буфер чужой сессии не подмешивается в открытую ленту', () => {
    const history = [message({ id: 'a', role: 'assistant', text: 'старый ответ' })];
    expect(mergeLiveMessage(history, baseLive({ sessionId: 's-2' }), 's-1')).toEqual(history);
  });
});
