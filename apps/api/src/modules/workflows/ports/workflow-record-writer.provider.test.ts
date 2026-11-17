import { describe, expect, it, vi } from 'vitest';

import { WorkflowRecordWriterProvider } from './workflow-record-writer.provider.js';

describe('WorkflowRecordWriterProvider (#434)', () => {
  it('пишет строку журнала с текущей стадией и видом действия', async () => {
    const records = { insert: vi.fn(async () => void 0) };
    const writer = new WorkflowRecordWriterProvider(records as never);
    await writer.write({} as never, {
      entityKind: 'task',
      entityId: 'task-1',
      transitionId: 'tr-1',
      stageId: 'stage-1',
      actorId: 'user-1',
      recordKind: 'return',
      participantId: 'user-2',
      comment: 'Доработать',
      fields: { reason: 'Доработать' },
    });
    expect(records.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityKind: 'task',
        entityId: 'task-1',
        transitionId: 'tr-1',
        fromStageId: 'stage-1',
        toStageId: 'stage-1',
        recordKind: 'return',
        participantId: 'user-2',
        comment: 'Доработать',
        fields: { reason: 'Доработать' },
      }),
    );
  });
});
