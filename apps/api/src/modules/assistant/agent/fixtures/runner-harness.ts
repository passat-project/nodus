import { vi } from 'vitest';

import { RunBusService, type RunEvent } from '../../run-bus.service.js';
import type { AssistantRepository, MessageRow } from '../../assistant.repository.js';
import type { AiSettingsService } from '../../providers/ai-settings.service.js';
import type { LlmChatRequest, LlmStreamEvent } from '../../providers/llm-provider.port.js';
import type { ToolExecutorService } from '../../tools/tool-executor.service.js';
import { AgentRunnerService } from '../agent-runner.service.js';
import type { RunParams } from '../agent-runner.service.js';
import type { AssistantCompactionService } from '../compaction.service.js';

/**
 * Стенд агентного цикла (#893, #901): хранилище прогона в памяти, провайдер
 * по сценарию шагов, фейковый исполнитель инструментов и заглушка реестра
 * MCP-серверов. Живёт в `fixtures/` — это код тестов, не продукт: сюда
 * вынесены общие фейки, чтобы каждый файл тестов читался по своей теме.
 */

export const logger = {
  setContext: () => undefined,
  error: () => undefined,
  warn: () => undefined,
};

/** Хранилище прогона в памяти — ровно те методы, что нужны циклу. */
export function fakeRepository() {
  const messages: MessageRow[] = [];
  const events: { seq: number; type: string; payload: unknown }[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  const toolCalls = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const repo = {
    createMessage: vi.fn(async (input: { sessionId: string; runId: string; role: string }) => {
      const row: MessageRow = {
        id: `msg-${messages.length + 1}`,
        sessionId: input.sessionId,
        runId: input.runId,
        role: input.role,
        text: '',
        reasoning: null,
        errorCode: null,
        createdAt: new Date(),
        runStatus: 'running',
        toolCalls: [],
        actions: [],
        actionBatch: null,
      };
      messages.push(row);
      return row;
    }),
    updateRun: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      runs.set(id, { ...(runs.get(id) ?? {}), ...patch });
    }),
    recentMessages: vi.fn(async () => messages.filter((row) => row.text !== '')),
    finishMessage: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const row = messages.find((item) => item.id === id);
      if (row) Object.assign(row, patch);
    }),
    createToolCall: vi.fn(async () => {
      const id = `call-${toolCalls.size + 1}`;
      toolCalls.set(id, {});
      return id;
    }),
    finishToolCall: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      toolCalls.set(id, patch);
    }),
    maxEventSeq: vi.fn(async () => seq),
    appendEvent: vi.fn(async (_runId: string, eventSeq: number, type: string, payload: unknown) => {
      seq = Math.max(seq, eventSeq);
      events.push({ seq: eventSeq, type, payload });
    }),
    eventsAfter: vi.fn(async (_runId: string, after: number) =>
      events
        .filter((event) => event.seq > after)
        .map((event) => ({ ...event, createdAt: new Date() })),
    ),
  };
  return { repo, messages, events, runs, toolCalls };
}

/** Провайдер по сценарию: массив шагов, каждый — поток событий. */
export function scriptedProvider(steps: LlmStreamEvent[][]) {
  let step = 0;
  const requests: LlmChatRequest[] = [];
  return {
    requests,
    async *streamChat(request: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
      requests.push(request);
      const events = steps[step] ?? [{ type: 'done', finishReason: 'stop' }];
      step += 1;
      for (const event of events) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield event;
      }
    },
    listModels: async () => [],
  };
}

/** Заглушка реестра MCP: по умолчанию включённых серверов нет. */
export function mcpStub(resolveEnabled: () => Promise<unknown> = async () => []): {
  resolveEnabled: ReturnType<typeof vi.fn>;
} {
  return { resolveEnabled: vi.fn(resolveEnabled) };
}

/** Прогон на стенде: те же фейки, что в agent-runner.test.ts. */
export function build(
  steps: LlmStreamEvent[][],
  options: { mcp?: { resolveEnabled: ReturnType<typeof vi.fn> } } = {},
) {
  const fake = fakeRepository();
  const bus = new RunBusService(fake.repo as unknown as AssistantRepository, logger as never);
  const executor = {
    execute: vi.fn(async () => ({
      ok: true,
      text: 'Задачи: 1\n1. №5 «Тест»',
      entity: { href: '?cards=task:1', label: '№5 Тест' },
    })),
  };
  const provider = scriptedProvider(steps);
  const settings = {
    resolveForRun: async () => ({
      providerId: 'provider-1',
      providerName: 'Фейк',
      modelId: 'fake-model',
      model: { id: 'fake-model', tools: true, vision: false, enabled: true },
      instructions: '',
      provider,
    }),
  };
  const mcp = options.mcp ?? mcpStub();
  const actions = {
    propose: vi.fn(async () => ({
      text: 'Действие подготовлено и ждёт подтверждения',
      action: null,
    })),
  };
  const memory = {
    promptLines: vi.fn(async () => [] as string[]),
    port: vi.fn(() => ({
      save: vi.fn(async (text: string) => ({ id: 'memory-1', text, duplicate: false })),
      list: vi.fn(async () => []),
      forget: vi.fn(async () => true),
    })),
  };
  const compaction = {
    historyPrefix: vi.fn(async () => [] as never[]),
    scheduleAfterRun: vi.fn(),
  };
  const runner = new AgentRunnerService(
    fake.repo as unknown as AssistantRepository,
    settings as unknown as AiSettingsService,
    mcp as never,
    executor as unknown as ToolExecutorService,
    actions as never,
    memory as never,
    compaction as never,
    bus,
    { register: vi.fn(() => () => undefined), notify: vi.fn() } as never,
    logger as never,
  );
  return {
    runner,
    bus,
    fake,
    executor,
    mcp,
    provider,
    requests: provider.requests,
    actions,
    memory,
    compaction: compaction as unknown as AssistantCompactionService,
  };
}

export const params: RunParams = {
  runId: 'run-1',
  sessionId: 'session-1',
  userId: 'user-1',
  authorization: 'Bearer test',
  permissions: ['assistant.use'],
  features: ['tasks'],
  screen: { moduleId: 'tasks', cardKind: null, cardId: null },
  autoExecute: false,
};

/** Дождаться терминального события прогона. */
export async function drain(bus: RunBusService): Promise<RunEvent[]> {
  return new Promise((resolve) => {
    const events: RunEvent[] = [];
    bus.stream('run-1', 0, { terminal: false }).subscribe({
      next: (event) => events.push(event),
      complete: () => resolve(events),
    });
  });
}
