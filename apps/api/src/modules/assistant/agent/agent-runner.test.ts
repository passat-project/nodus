import { describe, expect, it, vi } from 'vitest';

import { AgentRunnerService } from './agent-runner.service.js';
import type { RunEvent } from '../run-bus.service.js';
import type { AssistantRepository } from '../assistant.repository.js';
import type { AiSettingsService } from '../providers/ai-settings.service.js';
import type { LlmStreamEvent } from '../providers/llm-provider.port.js';
import type { ToolExecutorService } from '../tools/tool-executor.service.js';
import { RunBusService } from '../run-bus.service.js';
import { build, drain, logger, params } from './fixtures/runner-harness.js';

/**
 * Агентный цикл (#893): вызов инструмента → результат → финальный текст;
 * отмена сотрудником; лимит шагов; ошибка провайдера. Провайдер и
 * исполнитель инструментов — фейки из fixtures/runner-harness.
 */

describe('AgentRunnerService: цикл (#893)', () => {
  it('вызов инструмента → результат → финальный текст и usage', async () => {
    const { runner, bus, fake, executor } = build([
      [
        { type: 'reasoning.delta', text: 'Нужно посмотреть задачи. ' },
        {
          type: 'tool_call',
          call: {
            id: 'call_a',
            type: 'function',
            function: { name: 'tasks.list', arguments: '{"scope":"mine","limit":5}' },
          },
        },
        { type: 'usage', inputTokens: 100, outputTokens: 20 },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text.delta', text: 'У вас одна задача: ' },
        { type: 'text.delta', text: '№5 «Тест».' },
        { type: 'usage', inputTokens: 150, outputTokens: 30 },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const streamDone = drain(bus);
    runner.start(params);
    const events = await streamDone;

    expect(executor.execute).toHaveBeenCalledTimes(1);
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('run.started');
    expect(types).toContain('tool.started');
    expect(types).toContain('tool.finished');
    expect(types).toContain('message.delta');
    expect(types).toContain('reasoning.delta');
    expect(types.at(-1)).toBe('run.completed');

    const completed = events.find((event) => event.type === 'message.completed');
    expect(completed?.data).toMatchObject({
      text: 'У вас одна задача: №5 «Тест».',
      reasoning: 'Нужно посмотреть задачи. ',
    });
    const finishedRun = fake.runs.get('run-1');
    expect(finishedRun?.status).toBe('completed');
    expect(finishedRun?.inputTokens).toBe(250);
    expect(finishedRun?.outputTokens).toBe(50);
    // Вызов инструмента сохранён с результатом и ссылкой «Открыть».
    const toolCall = [...fake.toolCalls.values()][0];
    expect(toolCall).toMatchObject({ status: 'done', href: '?cards=task:1' });
  });

  it('отмена: стрим останавливается, частичный текст сохранён, статус cancelled', async () => {
    // Бесконечный поток дельт: отменяем после третьей.
    const infinite: LlmStreamEvent[] = Array.from({ length: 50 }, (_, index) => ({
      type: 'text.delta' as const,
      text: `токен${index} `,
    }));
    const { runner, bus, fake } = build([[...infinite, { type: 'done', finishReason: 'stop' }]]);
    const events: RunEvent[] = [];
    bus.stream('run-1', 0, { terminal: false }).subscribe((event) => {
      events.push(event);
      if (
        event.type === 'message.delta' &&
        events.filter((e) => e.type === 'message.delta').length === 3
      ) {
        runner.cancel('run-1');
      }
    });
    runner.start(params);
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('run.cancelled'), { timeout: 3_000 });

    expect(fake.runs.get('run-1')?.status).toBe('cancelled');
    const message = fake.messages[0];
    expect(message?.text).toContain('токен0');
    expect(message?.errorCode).toBeNull();
  });

  it('лимит шагов: модель зациклилась на вызовах — прогон останавливается', async () => {
    const callStep: LlmStreamEvent[] = [
      {
        type: 'tool_call',
        call: {
          id: 'call_loop',
          type: 'function',
          function: { name: 'tasks.list', arguments: '{}' },
        },
      },
      { type: 'done', finishReason: 'tool_calls' },
    ];
    const { runner, bus, fake } = build(Array.from({ length: 20 }, () => callStep));
    const streamDone = drain(bus);
    runner.start(params);
    const events = await streamDone;
    const error = events.find((event) => event.type === 'run.error');
    expect(error?.data).toMatchObject({ code: 'max_steps', retryable: true });
    expect(fake.runs.get('run-1')?.status).toBe('failed');
  });

  it('ошибка провайдера: понятный код и статус failed', async () => {
    const { runner, bus, fake } = build([
      [
        { type: 'text.delta', text: 'Начал отвечать' },
        // Провайдер обрывается: имитируем ошибку через исключение в потоке.
      ],
    ]);
    const provider = {
      async *streamChat(): AsyncIterable<LlmStreamEvent> {
        yield { type: 'text.delta', text: 'Начал' };
        throw Object.assign(new Error('rate limited'), {
          name: 'LlmProviderError',
          code: 'provider_rate_limited',
        });
      },
      listModels: async () => [],
    };
    // Перехватываем resolveForRun на «плохого» провайдера.
    const settings = {
      resolveForRun: async () => ({
        providerId: 'p',
        providerName: 'Фейк',
        modelId: 'm',
        model: { id: 'm', tools: true, vision: false, enabled: true },
        instructions: '',
        provider,
      }),
    };
    const bus2 = new RunBusService(fake.repo as unknown as AssistantRepository, logger as never);
    const mcp2 = { resolveEnabled: async () => [] };
    const runner2 = new AgentRunnerService(
      fake.repo as unknown as AssistantRepository,
      settings as unknown as AiSettingsService,
      mcp2 as never,
      { execute: vi.fn() } as unknown as ToolExecutorService,
      bus2,
      logger as never,
    );
    const streamDone = new Promise<RunEvent[]>((resolve) => {
      const events: RunEvent[] = [];
      bus2.stream('run-1', 0, { terminal: false }).subscribe({
        next: (event) => events.push(event),
        complete: () => resolve(events),
      });
    });
    runner2.start(params);
    const events = await streamDone;
    expect(events.at(-1)?.type).toBe('run.error');
    expect(fake.runs.get('run-1')?.status).toBe('failed');
    // Частичный текст не потерян — сотрудник видит, что успело прийти.
    expect(fake.messages[0]?.text).toBe('Начал');
    void runner;
    void bus;
  });
});

describe('RunBusService: восстановление потока (#893)', () => {
  it('после Last-Event-ID отдаёт только пропущенные события, без дублей', async () => {
    const { runner, bus, fake } = build([
      [
        { type: 'text.delta', text: 'а' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const all = drain(bus);
    runner.start(params);
    const events = await all;
    const afterThird = events.filter((event) => event.seq > (events[2]?.seq ?? 0));

    const replayed: RunEvent[] = [];
    await new Promise<void>((resolve) => {
      bus.stream('run-1', events[2]?.seq ?? 0, { terminal: true }).subscribe({
        next: (event) => replayed.push(event),
        complete: () => resolve(),
      });
    });
    expect(replayed.map((event) => event.seq)).toEqual(afterThird.map((event) => event.seq));
    expect(fake.events.length).toBeGreaterThan(0);
  });
});
