import { describe, expect, it, vi } from 'vitest';

import { AssistantContextRepository } from './assistant-context.repository.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Сегменты сжатия истории (#943): отдельная таблица модуля. Тест держит
 * стабильную форму строк для сервиса сжатия и точные аргументы запросов.
 */

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FROM_ID = '22222222-2222-4222-8222-222222222222';
const TO_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-18T10:00:00.000Z');

function segmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'segment-1',
    sessionId: SESSION_ID,
    fromMessageId: FROM_ID,
    toMessageId: TO_ID,
    seq: 1,
    digest: '1. ВОПРОС: Задачи?\n   ОТВЕТ (сжато): 3 задачи.',
    tokensBefore: 1_000,
    tokensAfter: 40,
    modelId: 'router-model',
    createdAt: NOW,
    ...overrides,
  };
}

function makeRepo() {
  const prisma = {
    assistantContextSegment: {
      findMany: vi.fn(async () => [segmentRow()]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => segmentRow(data)),
    },
  };
  return {
    repo: new AssistantContextRepository(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('AssistantContextRepository (#943)', () => {
  it('listContextSegments: по сессии и seq, строки без служебных полей', async () => {
    const { repo, prisma } = makeRepo();
    const segments = await repo.listContextSegments(SESSION_ID);
    expect(prisma.assistantContextSegment.findMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID },
      orderBy: { seq: 'asc' },
    });
    expect(segments[0]).toMatchObject({
      id: 'segment-1',
      seq: 1,
      tokensBefore: 1_000,
      tokensAfter: 40,
      modelId: 'router-model',
    });
  });

  it('createContextSegment: передаёт данные как есть и возвращает строку', async () => {
    const { repo, prisma } = makeRepo();
    const created = await repo.createContextSegment({
      sessionId: SESSION_ID,
      fromMessageId: FROM_ID,
      toMessageId: TO_ID,
      seq: 1,
      digest: 'сводка',
      tokensBefore: 1_000,
      tokensAfter: 40,
      modelId: null,
    });
    expect(prisma.assistantContextSegment.create).toHaveBeenCalledWith({
      data: {
        sessionId: SESSION_ID,
        fromMessageId: FROM_ID,
        toMessageId: TO_ID,
        seq: 1,
        digest: 'сводка',
        tokensBefore: 1_000,
        tokensAfter: 40,
        modelId: null,
      },
    });
    expect(created).toMatchObject({ seq: 1, digest: 'сводка' });
  });
});
