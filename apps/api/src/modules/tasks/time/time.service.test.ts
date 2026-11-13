import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, TASK_EVENTS, type AuthUser } from '@nodus/contracts';

import { isRunningTimer, TimeService } from './time.service.js';

const TX = { tx: true };
const USER = { id: 'bob', displayName: 'Боб', permissions: [] } as unknown as AuthUser;
const ROW = { id: 't1', number: 7, creatorId: 'alice', assigneeId: 'bob', participants: [] };

function setup(entry: Record<string, unknown>) {
  const repo = {
    findById: vi.fn().mockResolvedValue(entry),
    findByIdInTx: vi.fn().mockResolvedValue(entry),
    delete: vi.fn(),
    recalcSpentMinutes: vi.fn().mockResolvedValue({ ...ROW, spentMinutes: 30 }),
  };
  const eventBus = { emit: vi.fn() };
  const service = new TimeService(
    { run: (fn: (tx: unknown) => unknown) => fn(TX) } as never,
    eventBus as never,
    { visibleRow: vi.fn().mockResolvedValue(ROW) } as never,
    repo as never,
    {} as never,
    { findRefs: vi.fn().mockResolvedValue([]) } as never,
  );
  return { service, repo, eventBus };
}

describe('TimeService.remove', () => {
  it('removeInTx удаляет запись и пишет отрицательную дельту в журнал (#434)', async () => {
    const { service, repo, eventBus } = setup({
      id: 'e3',
      taskId: 't1',
      userId: 'bob',
      method: 'manual',
      minutes: 20,
      endedAt: new Date(),
    });
    await service.removeInTx(TX as never, 'bob', 'e3');
    expect(repo.delete).toHaveBeenCalledWith(TX, 'e3');
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      TASK_EVENTS.TIME_LOGGED,
      expect.objectContaining({ entryId: 'e3', minutes: -20 }),
      expect.anything(),
    );
  });

  it('идущий таймер удалить нельзя (409) — сначала «Стоп»', async () => {
    const { service, repo } = setup({
      id: 'e1',
      taskId: 't1',
      userId: 'bob',
      method: 'timer',
      endedAt: null,
      minutes: 0,
    });
    await expect(service.remove(USER, 'e1')).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('закрытая запись удаляется с пересчётом spentMinutes и событием (delta < 0)', async () => {
    const { service, repo, eventBus } = setup({
      id: 'e2',
      taskId: 't1',
      userId: 'bob',
      method: 'timer',
      endedAt: new Date(),
      minutes: 15,
    });
    await service.remove(USER, 'e2');
    expect(repo.delete).toHaveBeenCalledWith(TX, 'e2');
    expect(repo.recalcSpentMinutes).toHaveBeenCalledWith(TX, 't1');
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      TASK_EVENTS.TIME_LOGGED,
      expect.objectContaining({ entryId: 'e2', minutes: -15, spentMinutes: 30 }),
      expect.anything(),
    );
  });
});

describe('isRunningTimer', () => {
  it('идёт только таймер без ended_at', () => {
    expect(isRunningTimer({ method: 'timer', endedAt: null })).toBe(true);
    expect(isRunningTimer({ method: 'timer', endedAt: new Date() })).toBe(false);
    expect(isRunningTimer({ method: 'manual', endedAt: null })).toBe(false);
  });
});
