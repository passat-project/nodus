/* eslint-disable nodus-internal/max-lines-warn -- единая точка доступа модуля к своим таблицам (#893): сессии, сообщения, прогоны, события и вызовы инструментов живут вместе — разрез по агрегатам разорвал бы транзакционную картину модуля */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Единственная точка доступа модуля assistant к своим таблицам (patterns.md:
 * Prisma только в repository). Чужих таблиц не читает (I3/I6): содержимое
 * диалогов — собственные данные модуля, доменные сущности приходят только
 * через API-инструменты.
 */

import {
  type ActionBatchRow,
  type ActionRow,
  type ContextSegmentRow,
  type EventRow,
  type MemoryRow,
  type MessageRow,
  type RunRow,
  type SessionRow,
  type ToolCallRow,
} from './assistant.repository.types.js';
import {
  AssistantActionsRepository,
  mapAction,
  type ActionDbRow,
} from './assistant-actions.repository.js';

export type {
  ActionBatchRow,
  ActionRow,
  ContextSegmentRow,
  EventRow,
  MemoryRow,
  MessageRow,
  RunRow,
  SessionRow,
  ToolCallRow,
};

const MESSAGE_INCLUDE = {
  toolCalls: { orderBy: { seq: 'asc' } },
  actions: { orderBy: { createdAt: 'asc' } },
  run: { select: { status: true } },
  actionBatch: { select: { state: true } },
} as const;

@Injectable()
export class AssistantRepository extends AssistantActionsRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ----- Сессии -----

  async listSessions(userId: string, limit: number): Promise<SessionRow[]> {
    const rows = await this.prisma.assistantSession.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { _count: { select: { messages: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      title: row.title,
      archivedAt: row.archivedAt,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row._count.messages,
    }));
  }

  async findSession(userId: string, id: string): Promise<SessionRow | null> {
    const row = await this.prisma.assistantSession.findFirst({
      where: { id, userId },
      include: { _count: { select: { messages: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      archivedAt: row.archivedAt,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row._count.messages,
    };
  }

  async createSession(userId: string, title: string): Promise<SessionRow> {
    const row = await this.prisma.assistantSession.create({
      data: { userId, title },
      include: { _count: { select: { messages: true } } },
    });
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      archivedAt: row.archivedAt,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row._count.messages,
    };
  }

  async updateSession(
    userId: string,
    id: string,
    patch: { title?: string; archived?: boolean },
  ): Promise<SessionRow | null> {
    const existing = await this.findSession(userId, id);
    if (!existing) return null;
    await this.prisma.assistantSession.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
      },
    });
    return this.findSession(userId, id);
  }

  async touchSession(id: string, lastMessageAt: Date, title?: string): Promise<void> {
    await this.prisma.assistantSession.update({
      where: { id },
      data: { lastMessageAt, ...(title ? { title } : {}) },
    });
  }

  /** Удалить диалог владельца; сообщения/прогоны/события/вызовы — каскадом. */
  async deleteSession(userId: string, id: string): Promise<boolean> {
    const existing = await this.findSession(userId, id);
    if (!existing) return false;
    await this.prisma.assistantSession.delete({ where: { id } });
    return true;
  }

  // ----- Сообщения -----

  async listMessages(sessionId: string, limit: number): Promise<MessageRow[]> {
    const rows = await this.prisma.assistantMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: MESSAGE_INCLUDE,
    });
    return rows.map(mapMessage);
  }

  /** Последние `limit` сообщений в хронологическом порядке — для промпта. */
  async recentMessages(sessionId: string, limit: number): Promise<MessageRow[]> {
    const rows = await this.prisma.assistantMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: MESSAGE_INCLUDE,
    });
    return rows.map(mapMessage).reverse();
  }

  /** Сообщения строго раньше указанного — источник для сжатия старых ходов. */
  async messagesBefore(sessionId: string, before: { createdAt: Date }): Promise<MessageRow[]> {
    const rows = await this.prisma.assistantMessage.findMany({
      where: { sessionId, createdAt: { lt: before.createdAt } },
      orderBy: { createdAt: 'asc' },
      include: MESSAGE_INCLUDE,
    });
    return rows.map(mapMessage);
  }

  async createMessage(input: {
    sessionId: string;
    runId: string;
    role: 'user' | 'assistant';
    text?: string;
  }): Promise<MessageRow> {
    const row = await this.prisma.assistantMessage.create({
      data: {
        sessionId: input.sessionId,
        runId: input.runId,
        role: input.role,
        text: input.text ?? '',
      },
      include: MESSAGE_INCLUDE,
    });
    return mapMessage(row);
  }

  async finishMessage(
    id: string,
    patch: { text: string; reasoning: string | null; errorCode: string | null },
  ): Promise<void> {
    await this.prisma.assistantMessage.update({
      where: { id },
      data: { text: patch.text, reasoning: patch.reasoning, errorCode: patch.errorCode },
    });
  }

  // ----- Прогоны -----

  async createRun(input: {
    id: string;
    sessionId: string;
    userId: string;
    providerId: string | null;
    modelId: string | null;
    autoExecute?: boolean;
    continuationOfMessageId?: string | null;
  }): Promise<void> {
    await this.prisma.assistantRun.create({ data: input });
  }

  /** Убрать созданный прогон гонки (пачку уже продолжил другой запрос). */
  async deleteRun(id: string): Promise<void> {
    await this.prisma.assistantRun.deleteMany({ where: { id, status: 'queued' } });
  }

  /**
   * «Стоп» останавливает и зарезервированное продолжение пачки: прогон
   * закрывается, пачка возвращается в `open` — решение остаётся за
   * сотрудником («Продолжить сейчас» после остановки ответа).
   */
  async cancelQueuedRuns(sessionId: string): Promise<number> {
    const ids = await this.queuedRunIds({ sessionId });
    return this.releaseQueuedRuns(ids, 'cancelled', 'cancelled', 'Прогон остановлен сотрудником');
  }

  /** Отмена одного зарезервированного прогона (кнопкой «Стоп» по нему). */
  async cancelQueuedRun(runId: string): Promise<boolean> {
    const ids = await this.queuedRunIds({ id: runId });
    return (
      (await this.releaseQueuedRuns(
        ids,
        'cancelled',
        'cancelled',
        'Прогон остановлен сотрудником',
      )) > 0
    );
  }

  /**
   * Перезапуск API: отложенное продолжение жило в памяти процесса и не
   * переживает рестарт (окно — до конца печати исходного ответа). Прогон
   * закрывается `failed` (`interrupted`), пачка возвращается в `open`,
   * чтобы «Продолжить сейчас» работал, а не вёл в мёртвый прогон.
   */
  async recoverQueuedRuns(): Promise<number> {
    const ids = await this.queuedRunIds({});
    return this.releaseQueuedRuns(
      ids,
      'failed',
      'interrupted',
      'Прогон прерван перезапуском сервера',
    );
  }

  /** `queued` — только зарезервированные продолжения (#916): других нет. */
  private async queuedRunIds(where: { id?: string; sessionId?: string }): Promise<string[]> {
    const rows = await this.prisma.assistantRun.findMany({
      where: { ...where, status: 'queued' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async releaseQueuedRuns(
    ids: readonly string[],
    status: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const [runs] = await this.prisma.$transaction([
      this.prisma.assistantRun.updateMany({
        where: { id: { in: [...ids] }, status: 'queued' },
        data: { status, finishedAt: new Date(), errorCode, errorMessage },
      }),
      this.prisma.assistantActionBatch.updateMany({
        where: { continuationRunId: { in: [...ids] }, state: { in: ['continued', 'closed'] } },
        data: { state: 'open', continuationRunId: null },
      }),
    ]);
    return runs.count;
  }

  async findRun(userId: string, id: string): Promise<RunRow | null> {
    const row = await this.prisma.assistantRun.findFirst({ where: { id, userId } });
    return row ? mapRun(row) : null;
  }

  async findRunById(id: string): Promise<RunRow | null> {
    const row = await this.prisma.assistantRun.findUnique({ where: { id } });
    return row ? mapRun(row) : null;
  }

  async updateRun(
    id: string,
    patch: {
      status?: string;
      startedAt?: Date;
      finishedAt?: Date;
      inputTokens?: number | null;
      outputTokens?: number | null;
      contextTokens?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      providerId?: string | null;
      modelId?: string | null;
      continuationOfMessageId?: string | null;
    },
  ): Promise<void> {
    await this.prisma.assistantRun.update({ where: { id }, data: patch });
  }

  // ----- События прогона -----

  async appendEvent(
    runId: string,
    seq: number,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.assistantRunEvent.create({
      data: { runId, seq, type, payload: payload as Prisma.InputJsonValue },
    });
  }

  async eventsAfter(runId: string, lastSeq: number): Promise<EventRow[]> {
    const rows = await this.prisma.assistantRunEvent.findMany({
      where: { runId, seq: { gt: lastSeq } },
      orderBy: { seq: 'asc' },
    });
    return rows.map((row) => ({
      seq: row.seq,
      type: row.type,
      payload: row.payload,
      createdAt: row.createdAt,
    }));
  }

  /** Максимальный seq прогона: продолжение нумерации после перезапуска. */
  async maxEventSeq(runId: string): Promise<number> {
    const row = await this.prisma.assistantRunEvent.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return row?.seq ?? 0;
  }

  // ----- Вызовы инструментов -----

  async createToolCall(input: {
    runId: string;
    messageId: string | null;
    seq: number;
    toolId: string;
    title: string;
    args: unknown;
  }): Promise<string> {
    const row = await this.prisma.assistantToolCall.create({
      data: {
        runId: input.runId,
        messageId: input.messageId,
        seq: input.seq,
        toolId: input.toolId,
        title: input.title,
        args: (input.args ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row.id;
  }

  async finishToolCall(
    id: string,
    patch: {
      status: string;
      resultPreview: string | null;
      durationMs: number | null;
      errorCode: string | null;
      href: string | null;
      hrefLabel: string | null;
    },
  ): Promise<void> {
    await this.prisma.assistantToolCall.update({ where: { id }, data: patch });
  }

  // ----- Личная память (#900) -----

  async listMemories(userId: string, limit: number): Promise<MemoryRow[]> {
    const rows = await this.prisma.assistantMemory.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapMemory);
  }

  async countMemories(userId: string): Promise<number> {
    return this.prisma.assistantMemory.count({ where: { userId, archivedAt: null } });
  }

  async createMemory(input: {
    userId: string;
    text: string;
    sourceRunId: string | null;
  }): Promise<MemoryRow> {
    const row = await this.prisma.assistantMemory.create({ data: input });
    return mapMemory(row);
  }

  /** Архивация записи владельца; чужая/несуществующая — false (404 наружу). */
  async archiveMemory(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.assistantMemory.updateMany({
      where: { id, userId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return result.count === 1;
  }
}

function mapMessage(row: {
  id: string;
  sessionId: string;
  runId: string | null;
  role: string;
  text: string;
  reasoning: string | null;
  errorCode: string | null;
  createdAt: Date;
  run: { status: string } | null;
  toolCalls: {
    id: string;
    runId: string;
    messageId: string | null;
    seq: number;
    toolId: string;
    title: string;
    status: string;
    args: unknown;
    resultPreview: string | null;
    durationMs: number | null;
    errorCode: string | null;
    href: string | null;
    hrefLabel: string | null;
  }[];
  actions: ActionDbRow[];
  actionBatch: { state: string } | null;
}): MessageRow {
  const actions = row.actions.map(mapAction);
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    role: row.role,
    text: row.text,
    reasoning: row.reasoning,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    runStatus: row.run?.status ?? null,
    toolCalls: row.toolCalls.map((call) => ({
      id: call.id,
      runId: call.runId,
      messageId: call.messageId,
      seq: call.seq,
      toolId: call.toolId,
      title: call.title,
      status: call.status,
      args: call.args,
      resultPreview: call.resultPreview,
      durationMs: call.durationMs,
      errorCode: call.errorCode,
      href: call.href,
      hrefLabel: call.hrefLabel,
    })),
    actions,
    actionBatch: row.actionBatch,
  };
}

function mapMemory(row: {
  id: string;
  userId: string;
  text: string;
  sourceRunId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryRow {
  return {
    id: row.id,
    userId: row.userId,
    text: row.text,
    sourceRunId: row.sourceRunId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRun(row: {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  continuationOfMessageId: string | null;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  contextTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): RunRow {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    status: row.status,
    continuationOfMessageId: row.continuationOfMessageId,
    providerId: row.providerId,
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    contextTokens: row.contextTokens,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}
