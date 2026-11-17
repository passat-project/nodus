import { describe, expect, it, vi } from 'vitest';

import { WorkflowPublishedPressHandler } from './workflow-published-press.handler.js';

function setup() {
  const reader = { pressStageIds: vi.fn(async () => ['s1']) };
  const tasks = { liveIdsInStages: vi.fn(async () => ['t1', 't2']) };
  const press = { ensureForStage: vi.fn(async () => undefined) };
  const handler = new WorkflowPublishedPressHandler(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } as never,
    tasks as never,
    press as never,
    reader as never,
  );
  return { handler, reader, tasks, press };
}

describe('WorkflowPublishedPressHandler (#434, Б1)', () => {
  it('публикация задачи стартует сбор в стадиях с коллективной кнопкой', async () => {
    const { handler, press } = setup();
    await handler.handle({
      payload: { workflowId: 'w1', category: 'task' },
    } as never);
    expect(press.ensureForStage).toHaveBeenCalledTimes(2);
    expect(press.ensureForStage).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ notify: true }),
    );
  });

  it('публикация письма сбор не запускает', async () => {
    const { handler, reader, tasks, press } = setup();
    await handler.handle({
      payload: { workflowId: 'w1', category: 'letter' },
    } as never);
    expect(reader.pressStageIds).not.toHaveBeenCalled();
    expect(tasks.liveIdsInStages).not.toHaveBeenCalled();
    expect(press.ensureForStage).not.toHaveBeenCalled();
  });
});
