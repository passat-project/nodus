import { ErrorCode } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { letterSeriesTemplate } from './number-template.js';
import { NumberSeriesService } from './number-series.service.js';

const SERIES_ID = '00000000-0000-4000-8000-000000000501';
const TYPE_ID = '00000000-0000-4000-8000-000000000502';

function txOf(overrides: {
  typeConfig?: unknown;
  series?: { id: string; period: string; template: unknown; startValue: number } | null;
  lastValue?: number;
}) {
  const tx = {
    processType: { findUnique: vi.fn().mockResolvedValue({ config: overrides.typeConfig ?? {} }) },
    numberSeries: { findUnique: vi.fn().mockResolvedValue(overrides.series ?? null) },
    $queryRaw: vi.fn().mockResolvedValue([{ last_value: overrides.lastValue ?? 1 }]),
  };
  return tx as unknown as TransactionClient & typeof tx;
}

const LETTER_SERIES = {
  id: SERIES_ID,
  period: 'year',
  template: letterSeriesTemplate('Вх'),
  startValue: 1,
};

describe('NumberSeriesService (#55 → #630, Р3)', () => {
  it('номер типа без серии — 409 WORKFLOW_NUMBERING_NOT_CONFIGURED', async () => {
    const service = new NumberSeriesService();
    const tx = txOf({ typeConfig: { card: {}, access: {} } });
    await expect(service.nextForType(tx, TYPE_ID)).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
    });
  });

  it('номер по серии типа: «Вх-ГГГГ/N» из шаблона, год и ключ — по Минску', async () => {
    const service = new NumberSeriesService();
    const tx = txOf({
      typeConfig: { numbering: { seriesId: SERIES_ID } },
      series: LETTER_SERIES,
      lastValue: 118,
    });
    // 31.12.2026 23:30 UTC = 01.01.2027 02:30 в Минске.
    const number = await service.nextForType(tx, TYPE_ID, new Date('2026-12-31T23:30:00.000Z'));
    expect(number).toMatchObject({
      seriesId: SERIES_ID,
      scopeKey: '2027',
      year: 2027,
      seq: 118,
      display: 'Вх-2027/118',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('отсутствующая серия — 409, а не «номер без шаблона»', async () => {
    const service = new NumberSeriesService();
    const tx = txOf({ series: null });
    await expect(service.next(tx, SERIES_ID, 'common')).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('битый шаблон серии — 409 (сломанная конфигурация)', async () => {
    const service = new NumberSeriesService();
    const tx = txOf({
      typeConfig: { numbering: { seriesId: SERIES_ID } },
      series: { ...LETTER_SERIES, template: [{ kind: 'literal', text: 'Книга' }] },
    });
    await expect(service.nextForType(tx, TYPE_ID)).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
      message: 'Number series template is invalid',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('стартовое значение ложится в INSERT первой выдачи группы', async () => {
    const service = new NumberSeriesService();
    const tx = txOf({
      series: {
        id: SERIES_ID,
        period: 'none',
        template: [{ kind: 'literal', text: 'Изм. ' }, { kind: 'counter' }],
        startValue: 1041,
      },
      lastValue: 1041,
    });
    const number = await service.next(tx, SERIES_ID, 'common');
    expect(number).toMatchObject({ seq: 1041, display: 'Изм. 1041', scopeKey: 'common' });
    // Первый номер группы = startValue (продолжение из Excel), не 1.
    const sql = tx.$queryRaw.mock.calls[0]![0] as unknown as { values: unknown[] };
    expect(sql.values).toContain(1041);
  });
});
