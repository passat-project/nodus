import { ErrorCode } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { letterSeriesTemplate } from './number-template.js';
import { NumberSeriesService } from './number-series.service.js';

const SERIES_ID = '00000000-0000-4000-8000-000000000501';
const TYPE_ID = '00000000-0000-4000-8000-000000000502';
const FOLDER_ID = '00000000-0000-4000-8000-000000000503';
const TASK_ID = '00000000-0000-4000-8000-000000000504';
const MARK_ID = '00000000-0000-4000-8000-000000000505';

interface SeriesStub {
  id: string;
  period: string;
  template: unknown;
  startValue: number;
  step: number;
}

function txOf(overrides: {
  typeConfig?: unknown;
  series?: SeriesStub | null;
  rows?: { last_value: number }[];
  current?: { lastValue: number } | null;
}) {
  const tx = {
    processType: { findUnique: vi.fn().mockResolvedValue({ config: overrides.typeConfig ?? {} }) },
    numberSeries: { findUnique: vi.fn().mockResolvedValue(overrides.series ?? null) },
    numberCounter: { findUnique: vi.fn().mockResolvedValue(overrides.current ?? null) },
    numberAssignment: { create: vi.fn().mockResolvedValue({}), count: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue(overrides.rows ?? [{ last_value: 1 }]),
  };
  return tx as unknown as TransactionClient & typeof tx;
}

const LETTER_SERIES: SeriesStub = {
  id: SERIES_ID,
  period: 'year',
  template: letterSeriesTemplate('Вх'),
  startValue: 1,
  step: 1,
};

const IZM_SERIES: SeriesStub = {
  id: SERIES_ID,
  period: 'none',
  template: [{ kind: 'literal', text: 'Изм. ' }, { kind: 'counter' }],
  startValue: 1,
  step: 1,
};

const inFolder = [{ entity: 'node' as const, id: FOLDER_ID }];

const sqlOf = (tx: ReturnType<typeof txOf>, call = 0) =>
  tx.$queryRaw.mock.calls[call]![0] as unknown as { values: unknown[] };

describe('NumberSeriesService (#55 → #630, модель v3)', () => {
  it('номер типа без серии — 409 WORKFLOW_NUMBERING_NOT_CONFIGURED', async () => {
    const tx = txOf({ typeConfig: { card: {}, access: {} } });
    await expect(new NumberSeriesService().nextForType(tx, TYPE_ID)).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
    });
  });

  it('письмо: «Вх-ГГГГ/N», сквозная, ключ — год по Минску (формат прода)', async () => {
    const tx = txOf({
      typeConfig: { numbering: { seriesId: SERIES_ID } },
      series: LETTER_SERIES,
      rows: [{ last_value: 118 }],
    });
    // 31.12.2026 23:30 UTC = 01.01.2027 02:30 в Минске.
    const number = await new NumberSeriesService().nextForType(
      tx,
      TYPE_ID,
      new Date('2026-12-31T23:30:00.000Z'),
    );
    expect(number).toMatchObject({
      scopeKey: '2027',
      hits: [],
      periodKey: '2027',
      year: 2027,
      seq: 118,
      display: 'Вх-2027/118',
    });
    expect(tx.numberAssignment.create).not.toHaveBeenCalled();
  });

  it('условие «папка»: ключ = id папки, журнал помнит место, запись, атрибут и способ', async () => {
    const tx = txOf({ series: IZM_SERIES, rows: [{ last_value: 3 }] });
    const number = await new NumberSeriesService().next(tx, SERIES_ID, {
      hits: inFolder,
      host: {
        kind: 'task',
        id: TASK_ID,
        fieldId: TYPE_ID,
        actorId: null,
        source: 'transition',
        sourceLabel: 'Выдать в печать',
      },
    });
    expect(number).toMatchObject({ scopeKey: FOLDER_ID, seq: 3, display: 'Изм. 3' });
    expect(sqlOf(tx).values).toContain(FOLDER_ID);
    expect(tx.numberAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seriesId: SERIES_ID,
        containerRefs: inFolder,
        seq: 3,
        display: 'Изм. 3',
        hostKind: 'task',
        hostId: TASK_ID,
        fieldId: TYPE_ID,
        source: 'transition',
        sourceLabel: 'Выдать в печать',
      }),
    });
  });

  it('два условия: ключ — id обоих значений через «|»', async () => {
    const tx = txOf({ series: IZM_SERIES, rows: [{ last_value: 1 }] });
    const number = await new NumberSeriesService().next(tx, SERIES_ID, {
      hits: [...inFolder, { entity: 'value', id: MARK_ID }],
    });
    expect(number.scopeKey).toBe(`${FOLDER_ID}|${MARK_ID}`);
  });

  it('отсутствующая серия и битый шаблон — 409 до выдачи', async () => {
    const missing = txOf({ series: null });
    await expect(
      new NumberSeriesService().next(missing, SERIES_ID, { hits: [] }),
    ).rejects.toMatchObject({ code: ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED });
    const broken = txOf({ series: { ...IZM_SERIES, template: [{ kind: 'literal', text: 'К' }] } });
    await expect(
      new NumberSeriesService().next(broken, SERIES_ID, { hits: [] }),
    ).rejects.toMatchObject({ message: 'Number series template is invalid' });
    expect(broken.$queryRaw).not.toHaveBeenCalled();
  });

  it('старт нового счёта и шаг ложатся в INSERT/UPDATE', async () => {
    const tx = txOf({
      series: { ...IZM_SERIES, startValue: 5, step: 10 },
      rows: [{ last_value: 5 }],
    });
    await new NumberSeriesService().next(tx, SERIES_ID, { hits: inFolder });
    expect(sqlOf(tx).values).toContain(5);
    expect(sqlOf(tx).values).toContain(10);
  });

  it('следующий номер: счёт создаётся/двигается на next − шаг', async () => {
    const tx = txOf({ series: IZM_SERIES, rows: [{ last_value: 1040 }] });
    const result = await new NumberSeriesService().setNext(tx, SERIES_ID, {
      hits: [],
      nextValue: 1041,
    });
    expect(result).toEqual({ lastValue: 1040 });
    expect(sqlOf(tx).values).toContain(1040);
    const stepped = txOf({ series: { ...IZM_SERIES, step: 10 }, rows: [{ last_value: 45 }] });
    await new NumberSeriesService().setNext(stepped, SERIES_ID, { hits: [], nextValue: 55 });
    expect(sqlOf(stepped).values).toContain(45);
  });

  it('следующий номер назад — 409 NUMBER_NEXT_BACKWARDS с текущим значением', async () => {
    const tx = txOf({ series: IZM_SERIES, rows: [], current: { lastValue: 12 } });
    await expect(
      new NumberSeriesService().setNext(tx, SERIES_ID, { hits: inFolder, nextValue: 3 }),
    ).rejects.toMatchObject({
      code: ErrorCode.NUMBER_NEXT_BACKWARDS,
      details: { lastValue: 12, nextValue: 3 },
    });
  });
});
