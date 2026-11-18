import { describe, expect, it } from 'vitest';
import { ASSISTANT_LIMITS } from '@nodus/contracts';

import type { LlmMessage } from '../providers/llm-provider.port.js';
import {
  clearOldToolResults,
  contextWindowTokens,
  estimateMessagesTokens,
  estimateTokens,
  shouldCompact,
} from './context-budget.js';

/**
 * Бюджет контекста (#943): порог сжатия 50% окна и очистка старых
 * результатов инструментов. Тесты держат решение владельца: работаем на
 * маленьком контексте, а сырые результаты старых шагов модели не нужны.
 */

function assistantCall(id: string, name = 'tasks.list'): LlmMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }],
  };
}

function toolResult(id: string, size: number): LlmMessage {
  return { role: 'tool', tool_call_id: id, content: 'х'.repeat(size) };
}

describe('порог сжатия', () => {
  it('окно читается из env и отбрасывает мусор', () => {
    expect(
      contextWindowTokens({ ASSISTANT_CONTEXT_WINDOW_TOKENS: '64000' } as NodeJS.ProcessEnv),
    ).toBe(64_000);
    expect(
      contextWindowTokens({ ASSISTANT_CONTEXT_WINDOW_TOKENS: '10' } as NodeJS.ProcessEnv),
    ).toBe(ASSISTANT_LIMITS.contextWindowTokens);
    expect(contextWindowTokens({} as NodeJS.ProcessEnv)).toBe(ASSISTANT_LIMITS.contextWindowTokens);
  });

  it('сжимает на 50% окна, а не на 80%', () => {
    expect(shouldCompact(null, 64_000)).toBe(false);
    expect(shouldCompact(0, 64_000)).toBe(false);
    expect(shouldCompact(31_999, 64_000)).toBe(false);
    expect(shouldCompact(32_000, 64_000)).toBe(true);
    expect(shouldCompact(40_000, 64_000)).toBe(true);
  });

  it('оценка токенов и сообщений не падает на пустом', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('абв')).toBe(1);
    expect(
      estimateMessagesTokens([
        { role: 'user', content: 'а'.repeat(300) },
        { role: 'assistant', content: 'б'.repeat(300) },
        toolResult('t1', 300),
      ]),
    ).toBe(300);
  });
});

describe('очистка старых результатов инструментов', () => {
  it('чистит всё сверх бюджета, сохраняя последние и пары tool_call_id', () => {
    const messages: LlmMessage[] = [];
    for (let index = 0; index < 10; index += 1) {
      messages.push(assistantCall(`call-${index}`));
      messages.push(toolResult(`call-${index}`, 10_000));
    }
    const cleared = clearOldToolResults(messages);
    const tools = messages.filter((message) => message.role === 'tool');
    expect(cleared).toBe(tools.length - ASSISTANT_LIMITS.toolResultKeep);
    expect(tools[0]?.content).toContain('Результат очищен');
    expect(tools[0]?.content).toContain('<data tool="tasks.list">');
    expect(tools[0]?.tool_call_id).toBe('call-0');
    expect(tools.at(-1)?.content.length).toBe(10_000);
    // Повторная очистка ничего не добавляет.
    expect(clearOldToolResults(messages)).toBe(0);
  });

  it('малый объём и последние результаты не трогает', () => {
    const messages = [
      assistantCall('a'),
      toolResult('a', 1_000),
      assistantCall('b'),
      toolResult('b', 1_000),
    ];
    expect(clearOldToolResults(messages)).toBe(0);
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(2);
  });
});
