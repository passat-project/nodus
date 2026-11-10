import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { StageCreate, StageUpdate } from './publish-planner.js';

export interface TransitionRow {
  name: string;
  fromStageId: string | null;
  toStageId: string;
  display: string;
  /** Смысл кнопки (#430): action | service. */
  intent: string;
  sortOrder: number;
  rules: Prisma.InputJsonValue;
  /** Окно при нажатии (#380) — часть документа маршрута. */
  form: Prisma.InputJsonValue;
}

/** Действие маршрута (#633): без смены статуса, стадия может быть null. */
export interface ActionRow {
  name: string;
  stageId: string | null;
  display: string;
  sortOrder: number;
  rules: Prisma.InputJsonValue;
  form: Prisma.InputJsonValue;
  steps: Prisma.InputJsonValue;
}

/**
 * Записи публикации маршрута (#378, ADR-0021): применение плана внутри
 * транзакции сервиса. Новые стадии и переходы — без кода (сервер верит
 * только своим кодам каталога); удаление — архивом (задачи и события
 * ссылаются на историю).
 */
@Injectable()
export class WorkflowPublishRepository {
  async createStage(
    tx: TransactionClient,
    workflowId: string,
    stage: Omit<StageCreate, 'docId'>,
  ): Promise<string> {
    const created = await tx.workflowStage.create({
      data: { workflowId, code: null, ...stage },
      select: { id: true },
    });
    return created.id;
  }

  async updateStage(tx: TransactionClient, update: StageUpdate): Promise<void> {
    await tx.workflowStage.update({
      where: { id: update.stageId },
      data: {
        name: update.name,
        color: update.color,
        systemState: update.systemState,
        outcome: update.outcome,
        isInitial: update.isInitial,
        sortOrder: update.sortOrder,
      },
    });
  }

  async archiveStage(tx: TransactionClient, stageId: string, at: Date): Promise<void> {
    await tx.workflowStage.update({
      where: { id: stageId },
      data: { archivedAt: at, isInitial: false },
    });
  }

  async createTransition(
    tx: TransactionClient,
    workflowId: string,
    row: TransitionRow,
  ): Promise<string> {
    const created = await tx.workflowTransition.create({
      data: { workflowId, code: null, ...row },
      select: { id: true },
    });
    return created.id;
  }

  async updateTransition(tx: TransactionClient, id: string, row: TransitionRow): Promise<void> {
    await tx.workflowTransition.update({ where: { id }, data: { ...row, archivedAt: null } });
  }

  async archiveTransition(tx: TransactionClient, id: string, at: Date): Promise<void> {
    await tx.workflowTransition.update({ where: { id }, data: { archivedAt: at } });
  }

  async createAction(tx: TransactionClient, workflowId: string, row: ActionRow): Promise<string> {
    const created = await tx.workflowAction.create({
      data: { workflowId, code: null, ...row },
      select: { id: true },
    });
    return created.id;
  }

  async updateAction(tx: TransactionClient, id: string, row: ActionRow): Promise<void> {
    await tx.workflowAction.update({ where: { id }, data: { ...row, archivedAt: null } });
  }

  async archiveAction(tx: TransactionClient, id: string, at: Date): Promise<void> {
    await tx.workflowAction.update({ where: { id }, data: { archivedAt: at } });
  }

  /** Только раскладка холста — версия, дата и автор публикации не меняются
   *  (оформление, не маршрут; #378 ред. 2). */
  async saveLayout(
    tx: TransactionClient,
    workflowId: string,
    layout: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.workflow.update({ where: { id: workflowId }, data: { layout } });
  }

  /** Новая версия маршрута + раскладка холста (общая для всех) + форма
   *  создания (#432): всё это части одного документа публикации. */
  async bumpVersion(
    tx: TransactionClient,
    workflowId: string,
    by: {
      userId: string;
      at: Date;
      layout: Prisma.InputJsonValue;
      creation?: Prisma.InputJsonValue | null;
    },
  ): Promise<number> {
    const published = await tx.workflow.update({
      where: { id: workflowId },
      data: {
        version: { increment: 1 },
        publishedAt: by.at,
        publishedById: by.userId,
        customizedAt: by.at,
        layout: by.layout,
        ...(by.creation === undefined
          ? {}
          : { creation: by.creation === null ? Prisma.DbNull : by.creation }),
      },
      select: { version: true },
    });
    return published.version;
  }
}
