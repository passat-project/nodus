import { describe, expect, it, vi } from 'vitest';

import { AssistantRepository } from './assistant.repository.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Прогоны, журнал событий и вызовы инструментов ассистента (#893): точные
 * аргументы запросов, нумерация `seq` после перезапуска и патчи закрытия
 * вызова. Историю сообщений и сессии — `assistant-repository.test.ts`.
 */

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CALL_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-17T10:00:00.000Z');

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    title: 'Мои задачи',
    archivedAt: null,
    lastMessageAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { messages: 3 },
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    role: 'assistant',
    text: 'Ответ',
    reasoning: null,
    errorCode: null,
    createdAt: NOW,
    run: { status: 'running' },
    toolCalls: [
      {
        id: CALL_ID,
        runId: RUN_ID,
        messageId: MESSAGE_ID,
        seq: 1,
        toolId: 'tasks.list',
        title: 'Задачи: список',
        status: 'done',
        args: { scope: 'mine' },
        resultPreview: 'Задачи: 1',
        durationMs: 12,
        errorCode: null,
        href: null,
        hrefLabel: null,
      },
    ],
    ...overrides,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
    status: 'running',
    providerId: 'p1',
    modelId: 'm1',
    inputTokens: 10,
    outputTokens: 20,
    errorCode: null,
    errorMessage: null,
    startedAt: NOW,
    finishedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeRepo() {
  const prisma = {
    assistantSession: {
      findMany: vi.fn(async () => [sessionRow()]),
      findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => sessionRow()),
      create: vi.fn(async () => sessionRow()),
      update: vi.fn(async () => sessionRow()),
    },
    assistantMessage: {
      findMany: vi.fn(async () => [messageRow()]),
      create: vi.fn(async () => messageRow()),
      update: vi.fn(async () => messageRow()),
    },
    assistantRun: {
      create: vi.fn(async () => undefined),
      findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => runRow()),
      findUnique: vi.fn(async (): Promise<Record<string, unknown> | null> => runRow()),
      update: vi.fn(async () => runRow()),
    },
    assistantRunEvent: {
      create: vi.fn(async () => undefined),
      findMany: vi.fn(async () => [
        { seq: 2, type: 'text.delta', payload: { text: 'при' }, createdAt: NOW },
      ]),
      findFirst: vi.fn(async (): Promise<{ seq: number } | null> => ({ seq: 7 })),
    },
    assistantToolCall: {
      create: vi.fn(async () => ({ id: CALL_ID })),
      update: vi.fn(async () => undefined),
    },
  };
  return { repo: new AssistantRepository(prisma as unknown as PrismaService), prisma };
}

describe('AssistantRepository: прогоны и события (#893)', () => {
  it('createRun пишет выбор провайдера и модель', async () => {
    const { repo, prisma } = makeRepo();
    await repo.createRun({
      id: RUN_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerId: 'p1',
      modelId: 'm1',
    });
    expect(prisma.assistantRun.create).toHaveBeenCalledWith({
      data: { id: RUN_ID, sessionId: SESSION_ID, userId: USER_ID, providerId: 'p1', modelId: 'm1' },
    });
  });

  it('findRun проверяет владельца, findRunById — нет (внутренний вызов)', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.findRun(USER_ID, RUN_ID)).toMatchObject({ id: RUN_ID });
    expect(prisma.assistantRun.findFirst).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: USER_ID },
    });
    expect(await repo.findRunById(RUN_ID)).toMatchObject({ id: RUN_ID });
    expect(prisma.assistantRun.findUnique).toHaveBeenCalledWith({ where: { id: RUN_ID } });

    prisma.assistantRun.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findRun(USER_ID, RUN_ID)).toBeNull();
    prisma.assistantRun.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findRunById(RUN_ID)).toBeNull();
  });

  it('updateRun передаёт патч как есть', async () => {
    const { repo, prisma } = makeRepo();
    await repo.updateRun(RUN_ID, { status: 'completed', finishedAt: NOW, outputTokens: 42 });
    expect(prisma.assistantRun.update).toHaveBeenCalledWith({
      where: { id: RUN_ID },
      data: { status: 'completed', finishedAt: NOW, outputTokens: 42 },
    });
  });

  it('appendEvent пишет seq/type/payload; eventsAfter фильтрует seq и сортирует', async () => {
    const { repo, prisma } = makeRepo();
    await repo.appendEvent(RUN_ID, 3, 'text.delta', { text: 'при' });
    expect(prisma.assistantRunEvent.create).toHaveBeenCalledWith({
      data: { runId: RUN_ID, seq: 3, type: 'text.delta', payload: { text: 'при' } },
    });

    const events = await repo.eventsAfter(RUN_ID, 1);
    expect(prisma.assistantRunEvent.findMany).toHaveBeenCalledWith({
      where: { runId: RUN_ID, seq: { gt: 1 } },
      orderBy: { seq: 'asc' },
    });
    expect(events[0]).toMatchObject({ seq: 2, type: 'text.delta' });
  });

  it('maxEventSeq: пустая история — 0, иначе последний seq', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.maxEventSeq(RUN_ID)).toBe(7);
    prisma.assistantRunEvent.findFirst.mockResolvedValueOnce(null);
    expect(await repo.maxEventSeq(RUN_ID)).toBe(0);
  });
});

describe('AssistantRepository: вызовы инструментов (#893)', () => {
  it('createToolCall подставляет {} вместо пустых аргументов и отдаёт id', async () => {
    const { repo, prisma } = makeRepo();
    const id = await repo.createToolCall({
      runId: RUN_ID,
      messageId: null,
      seq: 1,
      toolId: 'tasks.list',
      title: 'Задачи: список',
      args: null,
    });
    expect(id).toBe(CALL_ID);
    expect(prisma.assistantToolCall.create).toHaveBeenCalledWith({
      data: {
        runId: RUN_ID,
        messageId: null,
        seq: 1,
        toolId: 'tasks.list',
        title: 'Задачи: список',
        args: {},
      },
      select: { id: true },
    });
  });

  it('finishToolCall закрывает вызов полным патчем', async () => {
    const { repo, prisma } = makeRepo();
    const patch = {
      status: 'done',
      resultPreview: 'Задачи: 1',
      durationMs: 12,
      errorCode: null,
      href: '?cards=task:1',
      hrefLabel: 'Задача',
    };
    await repo.finishToolCall(CALL_ID, patch);
    expect(prisma.assistantToolCall.update).toHaveBeenCalledWith({
      where: { id: CALL_ID },
      data: patch,
    });
  });
});
