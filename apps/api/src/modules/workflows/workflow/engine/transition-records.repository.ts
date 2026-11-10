import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../../core/database/transaction-runner.js';

/**
 * Общий журнал переходов «Процессов» (ADR-0024 п.4, #380): одна строка на
 * каждый переход через движок. Таблица принадлежит модулю «Процессы» —
 * пишет её движок в транзакции вызывающего, адаптеры категорий её не
 * трогают (иначе у писем появилась бы копия). `recordKind` и `participantId`
 * — задел сбора отметок #434; `answers` — вопросы #381.
 */
export interface TransitionRecordRow {
  id: string;
  /** Категория сущности: task | letter (словарь ProcessType.category). */
  entityKind: string;
  entityId: string;
  transitionId: string | null;
  /** Действие без смены статуса (#633); null — запись перехода/сбора. */
  actionId?: string | null;
  fromStageId: string;
  toStageId: string;
  actorId: string | null;
  rule: string | null;
  recordKind: 'transition' | 'action' | 'press' | 'return' | 'withdraw' | 'exclude';
  participantId: string | null;
  comment: string | null;
  /** Ревизия итога сущности (TaskResult у задач), а не исход перехода. */
  resultId: string | null;
  fields: Record<string, unknown>;
  timeEntryId: string | null;
  answers?: unknown[];
}

@Injectable()
export class TransitionRecordsRepository {
  async insert(tx: TransactionClient, row: TransitionRecordRow): Promise<void> {
    await tx.transitionRecord.create({
      data: {
        id: row.id,
        entityKind: row.entityKind,
        entityId: row.entityId,
        transitionId: row.transitionId,
        actionId: row.actionId ?? null,
        fromStageId: row.fromStageId,
        toStageId: row.toStageId,
        actorId: row.actorId,
        rule: row.rule,
        recordKind: row.recordKind,
        participantId: row.participantId,
        comment: row.comment,
        resultId: row.resultId,
        fields: row.fields as Prisma.InputJsonValue,
        timeEntryId: row.timeEntryId,
        answers: (row.answers ?? []) as Prisma.InputJsonValue,
      },
    });
  }
}
