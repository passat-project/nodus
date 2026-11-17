import { PrismaService } from '../../core/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActionBatchRow, ActionRow } from './assistant.repository.types.js';

/**
 * Карточки действий и пачки решений (#916, ADR-0048) — часть единой точки
 * доступа модуля к своим таблицам. Вынесено из `assistant.repository.ts`
 * по I5 (файл > 500 строк): `AssistantRepository` наследует этот класс,
 * DI и вызовы `repo.createAction(...)` не меняются.
 */
export abstract class AssistantActionsRepository {
  constructor(protected readonly prisma: PrismaService) {}

  // ----- Карточки действий (Ф2, ADR-0048) -----

  async createAction(input: {
    runId: string;
    messageId: string | null;
    userId: string;
    toolId: string;
    title: string;
    summary: string;
    fields: unknown;
    consequences: string;
    undoable: boolean;
    automatic: boolean;
    args: unknown;
  }): Promise<ActionRow> {
    const row = await this.prisma.assistantAction.create({
      data: {
        ...input,
        fields: (input.fields ?? []) as Prisma.InputJsonValue,
        args: (input.args ?? {}) as Prisma.InputJsonValue,
      },
    });
    return mapAction(row);
  }

  async findAction(userId: string, id: string): Promise<ActionRow | null> {
    const row = await this.prisma.assistantAction.findFirst({ where: { id, userId } });
    return row ? mapAction(row) : null;
  }

  async countRunActions(runId: string): Promise<number> {
    return this.prisma.assistantAction.count({ where: { runId } });
  }

  /**
   * Атомарный захват карточки под исполнение: `updateMany` с фильтром
   * состояния — второй параллельный клик получает 0 и не создаёт дубль.
   */
  async claimAction(id: string, from: readonly string[], to: string): Promise<boolean> {
    const result = await this.prisma.assistantAction.updateMany({
      where: { id, state: { in: [...from] } },
      data: { state: to },
    });
    return result.count === 1;
  }

  async finishAction(
    id: string,
    patch: {
      state: string;
      resultData?: unknown;
      resultPreview?: string | null;
      href?: string | null;
      hrefLabel?: string | null;
      errorCode?: string | null;
      executedAt?: Date | null;
      undoneAt?: Date | null;
    },
  ): Promise<ActionRow | null> {
    const { resultData, ...rest } = patch;
    await this.prisma.assistantAction.update({
      where: { id },
      data: {
        ...rest,
        ...(resultData !== undefined ? { resultData: resultData as Prisma.InputJsonValue } : {}),
      },
    });
    const row = await this.prisma.assistantAction.findUnique({ where: { id } });
    return row ? mapAction(row) : null;
  }

  /** Карточки сообщения (пачка #916): для «Выполнить все» / «Отменить все». */
  async findActionsByMessage(userId: string, messageId: string): Promise<ActionRow[]> {
    const rows = await this.prisma.assistantAction.findMany({
      where: { messageId, userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapAction);
  }

  // ----- Пачки карточек (#916) -----

  /**
   * Пачка создаётся первым предложением карточки хода; повтор не переоткрывает.
   * `createMany … skipDuplicates` = `INSERT … ON CONFLICT DO NOTHING`: модель
   * может вызвать несколько записей ОДНИМ пакетом (Promise.all), и `upsert`
   * в этой гонке падал на unique(message_id) — прогон с пачкой умирал (#916).
   */
  async ensureActionBatch(input: {
    messageId: string;
    sessionId: string;
    runId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.assistantActionBatch.createMany({
      data: [input],
      skipDuplicates: true,
    });
  }

  async findActionBatch(userId: string, messageId: string): Promise<ActionBatchRow | null> {
    const row = await this.prisma.assistantActionBatch.findFirst({
      where: { messageId, userId },
    });
    return row ? mapBatch(row) : null;
  }

  /**
   * Атомарный захват автопродолжения: только одна гонка (два последних
   * решения одновременно) получает `true` и запускает прогон.
   */
  async claimBatchContinuation(messageId: string, continuationRunId: string): Promise<boolean> {
    const result = await this.prisma.assistantActionBatch.updateMany({
      where: { messageId, state: 'open' },
      data: { state: 'continued', continuationRunId },
    });
    return result.count === 1;
  }

  /** «Продолжить сейчас» закрывает пачку; уже продолженная возвращает свой прогон. */
  async claimBatchContinueNow(messageId: string): Promise<ActionBatchRow | null> {
    const batch = await this.prisma.assistantActionBatch.findUnique({ where: { messageId } });
    if (!batch) return null;
    if (batch.state !== 'open') return mapBatch(batch);
    await this.prisma.assistantActionBatch.updateMany({
      where: { messageId, state: 'open' },
      data: { state: 'closed' },
    });
    const updated = await this.prisma.assistantActionBatch.findUnique({ where: { messageId } });
    return updated ? mapBatch(updated) : null;
  }

  /** Новое сообщение сотрудника закрывает открытые пачки сессии (#916, п. 4). */
  async closeOpenBatches(sessionId: string): Promise<void> {
    await this.prisma.assistantActionBatch.updateMany({
      where: { sessionId, state: 'open' },
      data: { state: 'closed' },
    });
  }

  /** Счётчики карточек пачки: `pending` — ждут решения (proposed/executing). */
  async countActionsByMessage(messageId: string): Promise<{ total: number; pending: number }> {
    const rows = await this.prisma.assistantAction.groupBy({
      by: ['state'],
      where: { messageId },
      _count: { _all: true },
    });
    let total = 0;
    let pending = 0;
    for (const row of rows) {
      const count = row._count._all;
      total += count;
      if (row.state === 'proposed' || row.state === 'executing') pending += count;
    }
    return { total, pending };
  }
}

/** Строка пачки из Prisma (`ActionBatchRow`). */
export function mapBatch(row: {
  id: string;
  messageId: string;
  sessionId: string;
  runId: string;
  userId: string;
  state: string;
  continuationRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ActionBatchRow {
  return {
    id: row.id,
    messageId: row.messageId,
    sessionId: row.sessionId,
    runId: row.runId,
    userId: row.userId,
    state: row.state,
    continuationRunId: row.continuationRunId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Строка карточки действия из Prisma (форма общая с `ActionRow`). */
export interface ActionDbRow {
  id: string;
  runId: string;
  messageId: string | null;
  userId: string;
  toolId: string;
  title: string;
  summary: string;
  fields: unknown;
  consequences: string;
  undoable: boolean;
  automatic: boolean;
  state: string;
  args: unknown;
  resultData: unknown;
  resultPreview: string | null;
  href: string | null;
  hrefLabel: string | null;
  errorCode: string | null;
  executedAt: Date | null;
  undoneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapAction(row: ActionDbRow): ActionRow {
  return {
    id: row.id,
    runId: row.runId,
    messageId: row.messageId,
    userId: row.userId,
    toolId: row.toolId,
    title: row.title,
    summary: row.summary,
    fields: row.fields,
    consequences: row.consequences,
    undoable: row.undoable,
    automatic: row.automatic,
    state: row.state,
    args: row.args,
    resultData: row.resultData,
    resultPreview: row.resultPreview,
    href: row.href,
    hrefLabel: row.hrefLabel,
    errorCode: row.errorCode,
    executedAt: row.executedAt,
    undoneAt: row.undoneAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
