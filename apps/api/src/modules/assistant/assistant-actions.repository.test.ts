import { describe, expect, it, vi } from 'vitest';

import { AssistantRepository } from './assistant.repository.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Карточки действий и пачки решений (#916, ADR-0048): маппинг строк и точные
 * запросы. Атомарность здесь — `updateMany` с фильтром состояния (второй
 * клик получает 0), а пачка — единственный `messageId` со сменой состояния
 * open → continued/closed. Сервисы проверяются своими тестами; тут — SQL-форма.
 */

const USER_ID = '44444444-4444-4444-8444-444444444444';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-11-17T10:00:00.000Z');

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    runId: RUN_ID,
    messageId: MESSAGE_ID,
    userId: USER_ID,
    toolId: 'tasks.create',
    title: 'Задачи: создать',
    summary: 'Создать задачу «Смета»',
    fields: [{ label: 'Название', value: 'Смета' }],
    consequences: 'Задача появится в журнале',
    undoable: true,
    automatic: false,
    state: 'proposed',
    args: { title: 'Смета' },
    resultData: null,
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    executedAt: null,
    undoneAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function batchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    messageId: MESSAGE_ID,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    userId: USER_ID,
    state: 'open',
    continuationRunId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRepo() {
  const prisma = {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    assistantAction: {
      create: vi.fn(async () => actionRow()),
      findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => actionRow()),
      findMany: vi.fn(async () => [actionRow()]),
      findUnique: vi.fn(async (): Promise<Record<string, unknown> | null> => actionRow()),
      count: vi.fn(async () => 2),
      update: vi.fn(async () => actionRow()),
      updateMany: vi.fn(async () => ({ count: 1 })),
      groupBy: vi.fn(async () => [
        { state: 'proposed', _count: { _all: 2 } },
        { state: 'executed', _count: { _all: 1 } },
      ]),
    },
    assistantActionBatch: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => batchRow()),
      findUnique: vi.fn(async (): Promise<Record<string, unknown> | null> => batchRow()),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { repo: new AssistantRepository(prisma as unknown as PrismaService), prisma };
}

describe('AssistantRepository: карточки действий (#916)', () => {
  it('createAction: JSONB-поля по умолчанию и маппинг строки', async () => {
    const { repo, prisma } = makeRepo();
    const action = await repo.createAction({
      runId: RUN_ID,
      messageId: MESSAGE_ID,
      userId: USER_ID,
      toolId: 'tasks.create',
      title: 'Задачи: создать',
      summary: 'Создать задачу',
      fields: null,
      consequences: 'Появится в журнале',
      undoable: true,
      automatic: false,
      args: null,
    });
    expect(prisma.assistantAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fields: [], args: {}, messageId: MESSAGE_ID }),
    });
    expect(action).toMatchObject({ id: ACTION_ID, messageId: MESSAGE_ID, state: 'proposed' });
  });

  it('createActionWithinLimit: count и вставка под локом прогона', async () => {
    const { repo, prisma } = makeRepo();
    const action = await repo.createActionWithinLimit(
      {
        runId: RUN_ID,
        messageId: MESSAGE_ID,
        userId: USER_ID,
        toolId: 'tasks.create',
        title: 'Задачи: создать',
        summary: 'Создать задачу',
        fields: null,
        consequences: 'Появится в журнале',
        undoable: true,
        automatic: false,
        args: null,
      },
      5,
    );
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(action).toMatchObject({ id: ACTION_ID });
  });

  it('createActionWithinLimit: лимит исчерпан — null без вставки', async () => {
    const { repo, prisma } = makeRepo();
    prisma.assistantAction.count.mockResolvedValueOnce(5);
    const action = await repo.createActionWithinLimit(
      {
        runId: RUN_ID,
        messageId: MESSAGE_ID,
        userId: USER_ID,
        toolId: 'tasks.create',
        title: 'Задачи: создать',
        summary: 'Создать задачу',
        fields: null,
        consequences: 'Появится в журнале',
        undoable: true,
        automatic: false,
        args: null,
      },
      5,
    );
    expect(action).toBeNull();
    expect(prisma.assistantAction.create).not.toHaveBeenCalled();
  });

  it('findAction: фильтр владельца, чужая — null', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.findAction(USER_ID, ACTION_ID)).toMatchObject({ id: ACTION_ID });
    expect(prisma.assistantAction.findFirst).toHaveBeenCalledWith({
      where: { id: ACTION_ID, userId: USER_ID },
    });
    prisma.assistantAction.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findAction(USER_ID, ACTION_ID)).toBeNull();
  });

  it('claimAction: updateMany по состояниям — второй клик получает false', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.claimAction(ACTION_ID, ['proposed', 'failed'], 'executing')).toBe(true);
    expect(prisma.assistantAction.updateMany).toHaveBeenCalledWith({
      where: { id: ACTION_ID, state: { in: ['proposed', 'failed'] } },
      data: { state: 'executing' },
    });
    prisma.assistantAction.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.claimAction(ACTION_ID, ['executed'], 'executing')).toBe(false);
  });

  it('finishAction: resultData пишется только если передан; исчезнувшая карточка — null', async () => {
    const { repo, prisma } = makeRepo();
    await repo.finishAction(ACTION_ID, { state: 'executed', executedAt: NOW });
    expect(prisma.assistantAction.update).toHaveBeenCalledWith({
      where: { id: ACTION_ID },
      data: { state: 'executed', executedAt: NOW },
    });

    await repo.finishAction(ACTION_ID, {
      state: 'executed',
      resultData: { taskId: 't-1' },
      resultPreview: '№653',
    });
    expect(prisma.assistantAction.update).toHaveBeenLastCalledWith({
      where: { id: ACTION_ID },
      data: { state: 'executed', resultPreview: '№653', resultData: { taskId: 't-1' } },
    });

    prisma.assistantAction.findUnique.mockResolvedValueOnce(null);
    expect(await repo.finishAction(ACTION_ID, { state: 'failed' })).toBeNull();
  });

  it('findActionsByMessage: карточки хода по порядку создания', async () => {
    const { repo, prisma } = makeRepo();
    const cards = await repo.findActionsByMessage(USER_ID, MESSAGE_ID);
    expect(prisma.assistantAction.findMany).toHaveBeenCalledWith({
      where: { messageId: MESSAGE_ID, userId: USER_ID },
      orderBy: { createdAt: 'asc' },
    });
    expect(cards).toHaveLength(1);
  });

  it('countActionsByMessage: pending — proposed/executing, прочие только в total', async () => {
    const { repo } = makeRepo();
    await expect(repo.countActionsByMessage(MESSAGE_ID, USER_ID)).resolves.toEqual({
      total: 3,
      pending: 2,
    });
  });
});

describe('AssistantRepository: пачки карточек (#916)', () => {
  it('ensureActionBatch: ON CONFLICT DO NOTHING не переоткрывает пачку', async () => {
    const { repo, prisma } = makeRepo();
    await repo.ensureActionBatch({
      messageId: MESSAGE_ID,
      sessionId: SESSION_ID,
      runId: RUN_ID,
      userId: USER_ID,
    });
    expect(prisma.assistantActionBatch.createMany).toHaveBeenCalledWith({
      data: [{ messageId: MESSAGE_ID, sessionId: SESSION_ID, runId: RUN_ID, userId: USER_ID }],
      skipDuplicates: true,
    });
  });

  it('findActionBatch: по сообщению и владельцу; чужая — null', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.findActionBatch(USER_ID, MESSAGE_ID)).toMatchObject({
      state: 'open',
      continuationRunId: null,
    });
    expect(prisma.assistantActionBatch.findFirst).toHaveBeenCalledWith({
      where: { messageId: MESSAGE_ID, userId: USER_ID },
    });
    prisma.assistantActionBatch.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findActionBatch(USER_ID, MESSAGE_ID)).toBeNull();
  });

  it('claimBatchContinuation: только open+владелец → continued, гонка получает false', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.claimBatchContinuation(MESSAGE_ID, USER_ID, 'run-2')).toBe(true);
    expect(prisma.assistantActionBatch.updateMany).toHaveBeenCalledWith({
      where: { messageId: MESSAGE_ID, userId: USER_ID, state: 'open' },
      data: { state: 'continued', continuationRunId: 'run-2' },
    });
    prisma.assistantActionBatch.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.claimBatchContinuation(MESSAGE_ID, USER_ID, 'run-3')).toBe(false);
  });

  it('claimBatchContinueNow: атомарно закрывает open и пишет прогон, гонка — false', async () => {
    const { repo, prisma } = makeRepo();
    expect(await repo.claimBatchContinueNow(MESSAGE_ID, USER_ID, 'run-2')).toBe(true);
    expect(prisma.assistantActionBatch.updateMany).toHaveBeenCalledWith({
      where: { messageId: MESSAGE_ID, userId: USER_ID, state: 'open' },
      data: { state: 'closed', continuationRunId: 'run-2' },
    });

    prisma.assistantActionBatch.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.claimBatchContinueNow(MESSAGE_ID, USER_ID, 'run-3')).toBe(false);
  });

  it('closeOpenBatches: новое сообщение закрывает открытые пачки сессии владельца', async () => {
    const { repo, prisma } = makeRepo();
    await repo.closeOpenBatches(SESSION_ID, USER_ID);
    expect(prisma.assistantActionBatch.updateMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID, userId: USER_ID, state: 'open' },
      data: { state: 'closed' },
    });
  });
});
