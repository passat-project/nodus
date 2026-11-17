import { CORRESPONDENCE_EVENTS, ErrorCode } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LetterStageMover } from './letter-stage.mover.js';

const LETTER = '00000000-0000-4000-8000-000000000411';
const SERIES = '00000000-0000-4000-8000-000000000412';
const ACTOR = '00000000-0000-4000-8000-000000000413';
const STAGE = '00000000-0000-4000-8000-000000000414';

function letter(overrides: Record<string, unknown> = {}) {
  return {
    id: LETTER,
    typeId: 'type',
    workflowId: 'wf',
    stageId: 'stage-new',
    systemState: 'backlog',
    direction: 'incoming',
    regNumber: null,
    registeredAt: null,
    counterpartyId: 'cp',
    signerId: null,
    addresseeId: 'addr',
    projectId: null,
    ...overrides,
  } as never;
}

const target = {
  id: STAGE,
  code: 'on_resolution',
  name: 'На резолюции',
  systemState: 'active',
  outcome: null,
};

const numbering = {
  seriesId: SERIES,
  year: 2026,
  seq: 118,
  display: 'Вх-2026/118',
  assignedAt: new Date('2026-10-27T08:00:00.000Z'),
};

function setup() {
  const letters = { update: vi.fn(async () => void 0), fileIds: vi.fn(async () => ['file-1']) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const mover = new LetterStageMover(letters as never, eventBus as never);
  return { mover, letters, eventBus };
}

describe('смена стадии письма (#55, Р1/Р3/Р5)', () => {
  it('регистрация включила «Конфиденциально» — letter_updated с fileIds', async () => {
    const { mover, eventBus } = setup();
    await mover.apply({} as never, letter(), target, ACTOR, {
      transitionId: 'tr',
      cause: 'transition',
      fieldChanges: { confidential: { from: false, to: true } },
    });
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CORRESPONDENCE_EVENTS.LETTER_UPDATED,
      expect.objectContaining({ confidential: true, fileIds: ['file-1'] }),
      expect.objectContaining({ aggregateType: 'letter', aggregateId: LETTER }),
    );
  });

  it('флаг не менялся — letter_updated не эмитится', async () => {
    const { mover, eventBus } = setup();
    await mover.apply({} as never, letter({ confidential: true }), target, ACTOR, {
      transitionId: 'tr',
      cause: 'transition',
      fieldChanges: { confidential: { from: true, to: true } },
    });
    expect(
      (eventBus.emit.mock.calls as unknown[][]).some(
        (call) => call[1] === CORRESPONDENCE_EVENTS.LETTER_UPDATED,
      ),
    ).toBe(false);
  });

  it('регистрация: reg_* в той же транзакции, событие stage_changed и letter_registered', async () => {
    const { mover, letters, eventBus } = setup();
    await mover.apply({} as never, letter(), target, ACTOR, {
      transitionId: 'tr',
      cause: 'transition',
      recordId: 'rec',
      transitionName: 'Зарегистрировать',
      fromStageName: 'Новое',
      numbering,
    });
    expect(letters.update).toHaveBeenCalledWith(
      expect.anything(),
      LETTER,
      expect.objectContaining({
        stageId: STAGE,
        systemState: 'active',
        regNumber: 'Вх-2026/118',
        regSeriesId: SERIES,
        regYear: 2026,
        regSeq: 118,
        registrarId: ACTOR,
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CORRESPONDENCE_EVENTS.LETTER_STAGE_CHANGED,
      expect.objectContaining({ letterId: LETTER, toStageName: 'На резолюции' }),
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CORRESPONDENCE_EVENTS.LETTER_REGISTERED,
      expect.objectContaining({ letterId: LETTER, regNumber: 'Вх-2026/118' }),
      expect.anything(),
    );
  });

  it('номер зарегистрированному письму — 409 LETTER_ALREADY_REGISTERED (страховка Р3)', async () => {
    const { mover, letters } = setup();
    await expect(
      mover.apply(
        {} as never,
        letter({ registeredAt: new Date(), regNumber: 'Вх-2026/1' }),
        target,
        ACTOR,
        {
          transitionId: 'tr',
          cause: 'transition',
          numbering,
        },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.LETTER_ALREADY_REGISTERED });
    expect(letters.update).not.toHaveBeenCalled();
  });

  it('закрытие без регистрации: событие closed_unregistered по коду стадии', async () => {
    const { mover, eventBus } = setup();
    await mover.apply(
      {} as never,
      letter(),
      {
        ...target,
        code: 'not_registered',
        name: 'Не зарегистрировано',
        systemState: 'closed',
        outcome: 'cancelled',
      },
      ACTOR,
      {
        transitionId: 'tr',
        cause: 'transition',
        recordId: 'rec',
        transitionName: 'Закрыть без регистрации',
        fromStageName: 'Новое',
        comment: 'ошибочный скан',
      },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CORRESPONDENCE_EVENTS.LETTER_CLOSED_UNREGISTERED,
      { letterId: LETTER },
      expect.anything(),
    );
    const calls = eventBus.emit.mock.calls as unknown as unknown[][];
    const registeredCalls = calls.filter(
      (call) => call[1] === CORRESPONDENCE_EVENTS.LETTER_REGISTERED,
    );
    expect(registeredCalls).toHaveLength(0);
  });
});
