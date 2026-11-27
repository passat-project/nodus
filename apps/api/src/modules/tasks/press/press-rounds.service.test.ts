import { describe, expect, it } from 'vitest';

import { ROUND, setup, TASK } from './press-rounds.test-fixtures.js';

/** Жизненный цикл раунда (#434, решения владельца 11.11.2026): пауза
 *  сохраняет прогресс, завершённый раунд читается, пустые источники дают
 *  статус для блокировки закрывающего перехода. */

describe('PressRoundsService (#434)', () => {
  it('пауза сохраняет открытый раунд: не отменяет и не создаёт новый', async () => {
    const { service, repo, tasks } = setup();
    tasks.findWithParticipants.mockResolvedValue({ ...TASK, systemState: 'paused' });

    const state = await service.ensureForStage({} as never, 't1');

    expect(state).toEqual({ transitionId: null, roundStarted: true, emptySources: false });
    expect(repo.cancelOpenRound).not.toHaveBeenCalled();
    expect(repo.createRound).not.toHaveBeenCalled();
  });

  it('возврат в статус: выбранные — returned, остальные сохраняют отметки (В2)', async () => {
    const { service, repo, events } = setup();
    repo.findOpenRound.mockResolvedValueOnce(null as never);
    repo.findLatestCompletedRound.mockResolvedValueOnce({
      ...ROUND,
      completedAt: new Date(),
      entries: [
        { ...ROUND.entries[0]! },
        { ...ROUND.entries[0]!, id: 'e2', userId: 'u2', order: 1 },
        {
          ...ROUND.entries[0]!,
          id: 'e3',
          userId: 'u3',
          order: 2,
          state: 'excluded',
          pressedAt: null,
          input: null,
          result: null,
        },
        {
          ...ROUND.entries[0]!,
          id: 'e4',
          userId: 'u4',
          order: 3,
          state: 'waiting',
          pressedAt: null,
          input: null,
          result: null,
        },
      ],
    } as never);

    const state = await service.ensureForStage({} as never, 't1', {
      notify: true,
      returnUserIds: ['u1'],
    });

    expect(state.roundStarted).toBe(true);
    const calls = repo.createRound.mock.calls as unknown as [
      unknown,
      { entries: { userId: string; state: string }[] },
    ][];
    const created = calls[0]?.[1];
    expect(created?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'u1', state: 'returned' }),
        expect.objectContaining({ userId: 'u2', state: 'pressed' }),
        expect.objectContaining({ userId: 'u3', state: 'excluded' }),
        expect.objectContaining({ userId: 'u4', state: 'excluded' }),
      ]),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      'task.press_requested',
      expect.objectContaining({ participantIds: ['u1'] }),
      expect.anything(),
    );
  });

  it('активная стадия: существующий раунд той же кнопки продолжается', async () => {
    const { service, repo } = setup();
    const state = await service.ensureForStage({} as never, 't1');
    expect(state).toEqual({ transitionId: 'tr1', roundStarted: true, emptySources: false });
    expect(repo.createRound).not.toHaveBeenCalled();
  });

  it('пустые источники: кнопка настроена, раунда нет — статус для 409', async () => {
    const { service, repo, sources } = setup();
    repo.findOpenRound.mockResolvedValueOnce(null as never);
    sources.resolve.mockResolvedValueOnce([]);

    const state = await service.ensureForStage({} as never, 't1');

    expect(state).toEqual({ transitionId: 'tr1', roundStarted: false, emptySources: true });
    expect(repo.createRound).not.toHaveBeenCalled();
  });

  it('после кворума карточка читает последний завершённый раунд (read-only)', async () => {
    const { service, repo } = setup();
    repo.findOpenRound.mockResolvedValueOnce(null as never);

    const view = await service.viewForTask('t1', 'closed-stage', 'viewer');

    expect(view?.completed).toBe(true);
    expect(view?.canSubmit).toBe(false);
    expect(view?.canReturn).toBe(false);
    expect(view?.entries[0]?.result?.text).toBe('Готово');
  });

  it('ответ внешнему нажавшему: последний раунд его собственной отметки', async () => {
    const { service, repo } = setup();
    const view = await service.viewLatestForTask('t1', 'external');
    expect(view?.id).toBe('r1');
    expect(repo.findLatestRoundForUser).toHaveBeenCalledWith(undefined, 'task', 't1', 'external');
  });

  it('чужой открытый раунд следующей стадии не отдаётся (#434, security)', async () => {
    const { service, repo } = setup();
    const foreign = {
      ...ROUND,
      id: 'r2',
      entries: [{ ...ROUND.entries[0], userId: 'other' }],
    };
    repo.findOpenRound.mockResolvedValueOnce(foreign as never);
    repo.findLatestRoundForUser.mockResolvedValueOnce({ ...ROUND, completedAt: new Date() });

    const view = await service.viewLatestForTask('t1', 'u1');

    expect(view?.id).toBe('r1');
    expect(view?.entries.map((entry) => entry.userId)).toEqual(['u1']);
  });
});
