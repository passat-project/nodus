import { describe, expect, it, vi } from 'vitest';

import { AssistantRepository } from './assistant.repository.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Единственная точка доступа модуля assistant к своим таблицам (#893).
 * Проверяем маппинг строк в `*Row` (сервисы и сериализаторы получают
 * стабильную форму) и точные аргументы запросов: фильтр владельца,
 * `archivedAt: null`, порядок и лимиты пагинации.
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
    actions: [],
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
      delete: vi.fn(async () => sessionRow()),
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

describe('AssistantRepository: сессии (#893)', () => {
  it('listSessions фильтрует по владельцу и архивности, маппит count', async () => {
    const { repo, prisma } = makeRepo();
    const list = await repo.listSessions(USER_ID, 50);
    expect(prisma.assistantSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, archivedAt: null }, take: 50 }),
    );
    expect(list[0]).toMatchObject({ id: SESSION_ID, messageCount: 3, archivedAt: null });
    expect(list[0]).not.toHaveProperty('_count');
  });

  it('findSession: чужая/отсутствующая — null без исключения', async () => {
    const { repo, prisma } = makeRepo();
    prisma.assistantSession.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findSession(USER_ID, SESSION_ID)).toBeNull();
    expect(prisma.assistantSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: USER_ID } }),
    );
  });

  it('createSession и updateSession возвращают актуальную строку', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.createSession(USER_ID, 'Заголовок')).toMatchObject({ title: 'Мои задачи' });
    expect(prisma.assistantSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: USER_ID, title: 'Заголовок' } }),
    );

    const updated = await repo.updateSession(USER_ID, SESSION_ID, { title: 'Новое' });
    expect(updated).toMatchObject({ id: SESSION_ID });
    expect(prisma.assistantSession.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: { title: 'Новое' },
    });
  });

  it('updateSession: архивация ставит дату, разархивация — null; чужая — null', async () => {
    const { repo, prisma } = makeRepo();
    await repo.updateSession(USER_ID, SESSION_ID, { archived: true });
    expect(prisma.assistantSession.update).toHaveBeenLastCalledWith({
      where: { id: SESSION_ID },
      data: { archivedAt: expect.any(Date) },
    });
    await repo.updateSession(USER_ID, SESSION_ID, { archived: false });
    expect(prisma.assistantSession.update).toHaveBeenLastCalledWith({
      where: { id: SESSION_ID },
      data: { archivedAt: null },
    });

    prisma.assistantSession.findFirst.mockResolvedValueOnce(null);
    expect(await repo.updateSession(USER_ID, SESSION_ID, { title: 'x' })).toBeNull();
    expect(prisma.assistantSession.update).toHaveBeenCalledTimes(2);
  });

  it('deleteSession: владелец — каскадное удаление; чужая/отсутствующая — false', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.deleteSession(USER_ID, SESSION_ID)).toBe(true);
    expect(prisma.assistantSession.delete).toHaveBeenCalledWith({ where: { id: SESSION_ID } });

    prisma.assistantSession.findFirst.mockResolvedValueOnce(null);
    expect(await repo.deleteSession(USER_ID, SESSION_ID)).toBe(false);
    expect(prisma.assistantSession.delete).toHaveBeenCalledTimes(1);
  });

  it('touchSession пишет lastMessageAt и заголовок только при наличии', async () => {
    const { repo, prisma } = makeRepo();
    await repo.touchSession(SESSION_ID, NOW);
    expect(prisma.assistantSession.update).toHaveBeenLastCalledWith({
      where: { id: SESSION_ID },
      data: { lastMessageAt: NOW },
    });
    await repo.touchSession(SESSION_ID, NOW, 'Первый вопрос');
    expect(prisma.assistantSession.update).toHaveBeenLastCalledWith({
      where: { id: SESSION_ID },
      data: { lastMessageAt: NOW, title: 'Первый вопрос' },
    });
  });
});

describe('AssistantRepository: сообщения (#893)', () => {
  it('listMessages: по возрастанию, с вызовами инструментов и статусом прогона', async () => {
    const { repo, prisma } = makeRepo();
    const messages = await repo.listMessages(SESSION_ID, 200);
    expect(prisma.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: SESSION_ID },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    );
    expect(messages[0]).toMatchObject({
      runStatus: 'running',
      toolCalls: [{ id: CALL_ID, args: { scope: 'mine' }, status: 'done' }],
    });
  });

  it('recentMessages переворачивает выборку в хронологический порядок', async () => {
    const { repo, prisma } = makeRepo();
    prisma.assistantMessage.findMany.mockResolvedValueOnce([
      messageRow({ id: 'newer', text: 'второй' }),
      messageRow({ id: 'older', text: 'первый' }),
    ]);
    const messages = await repo.recentMessages(SESSION_ID, 20);
    expect(prisma.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 20 }),
    );
    expect(messages.map((message) => message.id)).toEqual(['older', 'newer']);
  });

  it('messagesBefore: строго раньше границы и по возрастанию (#943)', async () => {
    const { repo, prisma } = makeRepo();
    const boundary = new Date('2026-11-17T10:00:00.000Z');
    await repo.messagesBefore(SESSION_ID, { createdAt: boundary });
    expect(prisma.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: SESSION_ID, createdAt: { lt: boundary } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('createMessage: пустой текст — строка, а не undefined; статус прогона null', async () => {
    const { repo, prisma } = makeRepo();
    prisma.assistantMessage.create.mockResolvedValueOnce(messageRow({ run: null }));
    const message = await repo.createMessage({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      role: 'user',
    });
    expect(prisma.assistantMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sessionId: SESSION_ID, runId: RUN_ID, role: 'user', text: '' },
      }),
    );
    expect(message.runStatus).toBeNull();
  });

  it('finishMessage сохраняет текст, размышления и код ошибки', async () => {
    const { repo, prisma } = makeRepo();
    await repo.finishMessage(MESSAGE_ID, { text: 'Ответ', reasoning: 'думал', errorCode: null });
    expect(prisma.assistantMessage.update).toHaveBeenCalledWith({
      where: { id: MESSAGE_ID },
      data: { text: 'Ответ', reasoning: 'думал', errorCode: null },
    });
  });
});
