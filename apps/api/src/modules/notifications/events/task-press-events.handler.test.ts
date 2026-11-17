import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@nodus/contracts';

import {
  TaskPressRequestedNotifyHandler,
  TaskPressReturnedNotifyHandler,
} from './task-events.handler.js';

const event = (type: string): DomainEvent<Record<string, unknown>> => ({
  id: 'e1',
  type,
  actorId: 'u1',
  payload: { taskId: 't1', number: 1, audience: [] },
  createdAt: new Date().toISOString(),
});

describe('уведомления сбора (#434)', () => {
  it('старт и возврат делегируют писателю журнала', async () => {
    const writer = { write: vi.fn(async () => void 0) };
    await new TaskPressRequestedNotifyHandler(writer as never).handle(
      event('task.press_requested'),
    );
    await new TaskPressReturnedNotifyHandler(writer as never).handle(event('task.press_returned'));
    expect(writer.write).toHaveBeenCalledTimes(2);
    expect(TaskPressRequestedNotifyHandler.eventType).toBe('task.press_requested');
    expect(TaskPressReturnedNotifyHandler.eventType).toBe('task.press_returned');
  });
});
