import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Запись общего журнала переходов (#434, ADR-0024 п.4): таблица принадлежит
 * «Процессам», поэтому отметки сбора (`press | return | withdraw`) пишутся
 * через порт владельца, а не SQL'ом модуля задач (I3). Владелец реализации —
 * workflows; потребители — задачи и письма.
 */
export const WORKFLOW_RECORD_WRITER: InjectionToken = 'WORKFLOW_RECORD_WRITER';

export interface WorkflowRecordInput {
  entityKind: string;
  entityId: string;
  transitionId: string | null;
  /** Стадия на момент действия: у отметки стадия не меняется. */
  stageId: string;
  actorId: string | null;
  recordKind: 'press' | 'return' | 'withdraw' | 'exclude';
  participantId: string | null;
  comment?: string | null;
  fields?: Record<string, unknown>;
  resultId?: string | null;
  timeEntryId?: string | null;
}

export interface WorkflowRecordWriter {
  write(tx: TransactionClient, input: WorkflowRecordInput): Promise<void>;
}
