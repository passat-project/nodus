import { describe, expect, it, vi } from 'vitest';

import { PressEvents } from './press-events.service.js';

const TASK = {
  id: 't1',
  number: 7,
  title: 'Сдать отчёт',
  creatorId: 'c',
  assigneeId: 'a',
  participants: [{ userId: 'u1', role: 'coexecutor' }],
};
const round = { entries: [{ userId: 'u1' }, { userId: 'u2' }], transitionName: 'Завершить' };

describe('PressEvents (#434)', () => {
  it('broadcast — только «Все сотрудники»', () => {
    const events = new PressEvents({ emit: vi.fn() } as never);
    expect(events.isBroadcast({ sources: [{ kind: 'all_employees' }] })).toBe(true);
    expect(events.isBroadcast({ sources: [{ kind: 'coexecutors' }] })).toBe(false);
  });

  it('прогресс адресного раунда идёт и участникам вне ролей', async () => {
    const emit = vi.fn(async () => void 0);
    const events = new PressEvents({ emit } as never);
    await events.updated({} as never, TASK as never, 'a', round, {
      sources: [{ kind: 'coexecutors' }],
    });
    expect(emit).toHaveBeenCalledWith(
      expect.anything(),
      'task.updated',
      expect.objectContaining({
        audience: expect.arrayContaining(['c', 'a', 'u1', 'u2']),
        fields: ['press'],
      }),
      expect.anything(),
    );
  });

  it('broadcast-прогресс не раздувает аудиторию участниками', async () => {
    const emit = vi.fn(async () => void 0);
    const events = new PressEvents({ emit } as never);
    await events.updated({} as never, TASK as never, 'a', round, {
      sources: [{ kind: 'all_employees' }],
    });
    const payload = (emit.mock.calls[0] as unknown[])[2] as { audience: string[] };
    expect(payload.audience).not.toContain('u2');
  });

  it('сдача и возврат пишут события блоков чата', async () => {
    const emit = vi.fn(async () => void 0);
    const events = new PressEvents({ emit } as never);
    await events.submitted(
      {} as never,
      TASK as never,
      'u1',
      'Завершить',
      { text: 'Итог', messageIds: [], fileCount: 2, minutes: 30, date: null },
      1,
      2,
    );
    await events.returned({} as never, TASK as never, 'a', round, ['u2'], 'Доработать', false);
    expect(emit).toHaveBeenCalledWith(
      expect.anything(),
      'task.press_submitted',
      expect.objectContaining({
        broadcast: false,
        result: expect.objectContaining({ fileCount: 2 }),
      }),
      expect.anything(),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.anything(),
      'task.press_returned',
      expect.objectContaining({ userIds: ['u2'], reason: 'Доработать', broadcast: false }),
      expect.anything(),
    );
  });

  it('broadcast-возврат адресует только возвращённым (и ролям задачи)', async () => {
    const emit = vi.fn(async () => void 0);
    const events = new PressEvents({ emit } as never);
    const wide = { entries: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }] };
    await events.returned({} as never, TASK as never, 'a', wide, ['u3'], 'Причина', true);
    const payload = (emit.mock.calls[0] as unknown[])[2] as { audience: string[] };
    expect(payload.audience).toContain('u3');
    expect(payload.audience).not.toContain('u2');
  });
});
