import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@nodus/contracts';

import { TaskUpdatedNotifyHandler } from './task-events.handler.js';

const event = (type: string): DomainEvent<Record<string, unknown>> => ({
  id: 'e1',
  type,
  actorId: 'u1',
  payload: { taskId: 't1', number: 1, audience: [] },
  createdAt: new Date().toISOString(),
});

describe('уведомление о смене срока (#996)', () => {
  it('task.updated делегирует общему писателю журнала', async () => {
    const writer = { write: vi.fn(async () => void 0) };
    await new TaskUpdatedNotifyHandler(writer as never).handle(event('task.updated'));
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(TaskUpdatedNotifyHandler.eventType).toBe('task.updated');
  });
});
