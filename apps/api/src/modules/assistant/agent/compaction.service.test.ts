import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_LIMITS } from '@nodus/contracts';

import type {
  AssistantRepository,
  ContextSegmentRow,
  MessageRow,
} from '../assistant.repository.js';
import type { AiSettingsService } from '../providers/ai-settings.service.js';
import type { LlmProvider, LlmStreamEvent } from '../providers/llm-provider.port.js';
import { AssistantCompactionService } from './compaction.service.js';

/**
 * Сервис сжатия (#943): порог 50%, сегменты из старых ходов, идемпотентность,
 * fallback при сбое модели и сборка префикса промпта. Вопросы сотрудника
 * обязаны оставаться дословными — это главная проверка.
 */

const SESSION = 'session-1';
const BASE = new Date('2026-11-01T10:00:00.000Z').getTime();

function message(index: number): MessageRow {
  const role = index % 2 === 0 ? 'user' : 'assistant';
  return {
    id: `m-${index}`,
    sessionId: SESSION,
    runId: `r-${index}`,
    role,
    text: role === 'user' ? `Вопрос ${index}` : `Ответ ${index} ${'деталь '.repeat(40)}`,
    reasoning: null,
    errorCode: null,
    createdAt: new Date(BASE + index * 1_000),
    runStatus: 'completed',
    toolCalls: [],
    actions: [],
    actionBatch: null,
  };
}

function segment(seq: number, from: number, to: number): ContextSegmentRow {
  return {
    id: `seg-${seq}`,
    sessionId: SESSION,
    fromMessageId: `m-${from}`,
    toMessageId: `m-${to}`,
    seq,
    digest: `Сегмент ${seq}`,
    tokensBefore: 1_000,
    tokensAfter: 100,
    modelId: 'router',
    createdAt: new Date(BASE + seq),
  };
}

function provider(text: string): LlmProvider {
  return {
    async *streamChat(): AsyncIterable<LlmStreamEvent> {
      yield { type: 'text.delta', text };
    },
    async listModels() {
      return [];
    },
  };
}

function build(input: {
  recent: MessageRow[];
  older: MessageRow[];
  segments?: ContextSegmentRow[];
  provider?: LlmProvider;
}) {
  let segments = input.segments ?? [];
  const repo = {
    recentMessages: vi.fn(async () => input.recent),
    messagesBefore: vi.fn(async () => input.older),
  };
  const contextRepo = {
    listContextSegments: vi.fn(async () => segments),
    createContextSegment: vi.fn(async (data: Omit<ContextSegmentRow, 'id' | 'createdAt'>) => {
      const row = { ...data, id: `seg-${data.seq}`, createdAt: new Date() };
      segments = [...segments, row];
      return row;
    }),
  };
  const model = { id: 'router', tools: false, vision: false, enabled: true };
  const summaryText = Array.from({ length: 40 }, (_, index) => `${index + 1}. Сжатый ответ`).join(
    '\n',
  );
  const settings = {
    resolveRouter: vi.fn(async () => ({
      providerId: 'p',
      modelId: 'router',
      model,
      provider: input.provider ?? provider(summaryText),
    })),
    resolveForRun: vi.fn(),
  };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const service = new AssistantCompactionService(
    repo as unknown as AssistantRepository,
    contextRepo as never,
    settings as unknown as AiSettingsService,
    logger as never,
  );
  return { service, repo, contextRepo, settings, logger };
}

describe('compactSession', () => {
  it('не сжимает, пока история помещается в последние 30 сообщений', async () => {
    const older = Array.from({ length: 10 }, (_, index) => message(index));
    const recent = Array.from({ length: 10 }, (_, index) => message(index));
    const { service, contextRepo } = build({ recent, older });
    expect(await service.compactSession(SESSION)).toBe(0);
    expect(contextRepo.createContextSegment).not.toHaveBeenCalled();
  });

  it('создаёт сегмент: вопрос дословно, ответ сжат, seq=1', async () => {
    const older = Array.from({ length: 32 }, (_, index) => message(index));
    const recent = Array.from({ length: 30 }, (_, index) => message(100 + index));
    const { service, contextRepo } = build({ recent, older });

    expect(await service.compactSession(SESSION)).toBe(1);
    const created = contextRepo.createContextSegment.mock.calls[0]?.[0];
    expect(created).toMatchObject({
      sessionId: SESSION,
      fromMessageId: 'm-0',
      toMessageId: 'm-31',
      seq: 1,
      modelId: 'router',
    });
    expect(created?.digest).toContain('ВОПРОС: Вопрос 0');
    expect(created?.digest).toContain('ОТВЕТ (сжато): Сжатый ответ');
    expect(created!.tokensBefore).toBeGreaterThan(created!.tokensAfter);
  });

  it('повторный запуск не создаёт дубль', async () => {
    const older = Array.from({ length: 32 }, (_, index) => message(index));
    const recent = Array.from({ length: 30 }, (_, index) => message(100 + index));
    const { service } = build({ recent, older });
    expect(await service.compactSession(SESSION)).toBe(1);
    expect(await service.compactSession(SESSION)).toBe(0);
  });

  it('сбой модели не теряет данные: сегмент с fallback-усечением', async () => {
    const older = Array.from({ length: 32 }, (_, index) => message(index));
    const recent = Array.from({ length: 30 }, (_, index) => message(100 + index));
    const failing: LlmProvider = {
      // eslint-disable-next-line require-yield -- имитация сбоя до первого события
      async *streamChat(): AsyncIterable<LlmStreamEvent> {
        throw new Error('provider down');
      },
      async listModels() {
        return [];
      },
    };
    const { service, contextRepo } = build({ recent, older, provider: failing });
    expect(await service.compactSession(SESSION)).toBe(1);
    const created = contextRepo.createContextSegment.mock.calls[0]?.[0];
    expect(created?.modelId).toBeNull();
    expect(created?.digest).toContain('ВОПРОС: Вопрос 0');
    expect(created!.tokensAfter).toBeLessThan(created!.tokensBefore);
  });

  it('короткие ответы: вместо раздувающего пересказа остаются только вопросы', async () => {
    const older = Array.from({ length: 32 }, (_, index) => ({
      ...message(index),
      text: index % 2 === 0 ? `Вопрос ${index}` : 'ок',
    }));
    const recent = Array.from({ length: 30 }, (_, index) => message(100 + index));
    const { service, contextRepo } = build({ recent, older });
    expect(await service.compactSession(SESSION)).toBe(1);
    const created = contextRepo.createContextSegment.mock.calls[0]?.[0];
    expect(created?.digest).toContain('ответы ассистента опущены');
    expect(created?.digest).not.toContain('Сжатый ответ');
  });
});

describe('historyPrefix', () => {
  it('без сегментов отдаёт только ранние ВОПРОСЫ, ответы опускает', async () => {
    const older = Array.from({ length: 32 }, (_, index) => message(index));
    const recent = Array.from({ length: 30 }, (_, index) => message(100 + index));
    const { service } = build({ recent, older });
    const blocks = await service.historyPrefix(SESSION, recent[0] ?? null);
    expect(blocks).toHaveLength(1);
    const content = String(blocks[0]?.content);
    expect(content).toContain('Несжатые ранние вопросы');
    expect(content).toContain('Вопрос 0');
    expect(content).toContain('Вопрос 30');
    expect(content).not.toContain('Ответ 1');
    expect(content).toContain('<data tool="assistant_history">');
  });

  it('сегменты идут блоками данных, после последнего — только несжатый хвост', async () => {
    const older = Array.from({ length: 32 }, (_, index) => message(index));
    const recent = Array.from({ length: 30 }, (_, index) => message(100 + index));
    const { service } = build({ recent, older, segments: [segment(1, 0, 9)] });
    const blocks = await service.historyPrefix(SESSION, recent[0] ?? null);
    expect(blocks).toHaveLength(2);
    expect(String(blocks[0]?.content)).toContain('Сегмент 1');
    const tail = String(blocks[1]?.content);
    expect(tail).toContain('Вопрос 10');
    expect(tail).not.toContain('Вопрос 0');
  });

  it('в промпт идут последние 8 сегментов, о скрытых — честная пометка', async () => {
    const segments = Array.from({ length: 10 }, (_, index) => segment(index + 1, 0, 9));
    const { service } = build({ recent: [], older: [], segments });
    const blocks = await service.historyPrefix(SESSION, null);
    expect(blocks).toHaveLength(1 + ASSISTANT_LIMITS.contextMaxSegments);
    expect(String(blocks[0]?.content)).toContain('2 сегм.');
    expect(String(blocks[1]?.content)).toContain('Сегмент 3');
  });

  it('порог 50% окна — решение владельца', () => {
    const { service } = build({ recent: [], older: [] });
    expect(service.shouldCompact(63_999)).toBe(false);
    expect(service.shouldCompact(64_000)).toBe(true);
  });
});
