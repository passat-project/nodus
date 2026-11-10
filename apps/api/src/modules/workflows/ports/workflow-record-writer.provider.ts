import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { TransitionRecordsRepository } from '../workflow/engine/transition-records.repository.js';
import type {
  WorkflowRecordInput,
  WorkflowRecordWriter,
} from './workflow-record-writer.port.js';

/** Реализация записи журнала «Процессов» для отметок сбора (#434). */
@Injectable()
export class WorkflowRecordWriterProvider implements WorkflowRecordWriter {
  constructor(private readonly records: TransitionRecordsRepository) {}

  async write(tx: TransactionClient, input: WorkflowRecordInput): Promise<void> {
    await this.records.insert(tx, {
      id: randomUUID(),
      entityKind: input.entityKind,
      entityId: input.entityId,
      transitionId: input.transitionId,
      fromStageId: input.stageId,
      toStageId: input.stageId,
      actorId: input.actorId,
      rule: null,
      recordKind: input.recordKind,
      participantId: input.participantId,
      comment: input.comment ?? null,
      resultId: input.resultId ?? null,
      fields: input.fields ?? {},
      timeEntryId: input.timeEntryId ?? null,
    });
  }
}
