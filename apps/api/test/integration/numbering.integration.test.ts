import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionRunner } from '../../src/core/database/transaction-runner.js';
import { NumberSeriesService } from '../../src/modules/workflows/numbering/number-series.service.js';
import {
  letterSeriesTemplate,
  numberScopeKey,
} from '../../src/modules/workflows/numbering/number-template.js';
import { setupChatFixture, type ChatTestFixture } from './chat-fixtures.js';

/**
 * Серии номеров на реальном PostgreSQL (#630, Пакет 0): инварианты
 * перестроенного хранилища. Юнит-тесты рендера не видят главного риска —
 * атомарности upsert на новом PK `(series_id, scope_key)` и отката
 * транзакции. Здесь живые транзакции: 8 параллельных выдач одной группы —
 * без дублей и потерь; откат tx — счётчик не сдвинулся; стартовое значение —
 * продолжение из Excel; годовой переход 31.12→01.01 — новая группа.
 * Письмо-путь (`nextForType`) проверяется на сид-серии каталога: рендер
 * «Вх-ГГГГ/N» бит-в-бит и продолжение перенесённого миграцией счётчика.
 */
describe.skipIf(!process.env.DATABASE_URL)('серии номеров (integration, #630)', () => {
  let fx: ChatTestFixture;
  let numbers: NumberSeriesService;
  let txRunner: TransactionRunner;
  const seriesIds: string[] = [];

  beforeAll(async () => {
    fx = await setupChatFixture([]); // пользователи не нужны: серии и tx
    numbers = fx.app.get(NumberSeriesService);
    txRunner = fx.app.get(TransactionRunner);
  }, 120_000);

  afterAll(async () => {
    await fx?.prisma.numberSeries.deleteMany({ where: { id: { in: seriesIds } } });
    await fx?.cleanup();
  });

  /** Серия прогона с уникальным code (уборка по id). */
  async function series(data: {
    template?: unknown;
    period?: string;
    startValue?: number;
  }): Promise<string> {
    const row = await fx.prisma.numberSeries.create({
      data: {
        code: `test-${fx.runId}-${seriesIds.length}`,
        prefix: 'Т',
        name: `Проба ${fx.runId}`,
        scopeKind: 'none',
        period: data.period ?? 'none',
        template: (data.template ?? [{ kind: 'counter' }]) as never,
        startValue: data.startValue ?? 1,
      },
      select: { id: true },
    });
    seriesIds.push(row.id);
    return row.id;
  }

  it('8 параллельных выдач одной группы: seq без дублей и потерь (К6)', async () => {
    const id = await series({});
    const issued = await Promise.all(
      Array.from({ length: 8 }, () => txRunner.run((tx) => numbers.next(tx, id, 'common'))),
    );
    const seqs = issued.map((n) => n.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(issued.map((n) => n.display)).size).toBe(8);
  });

  it('откат транзакции не сдвигает счётчик — номер не теряется и не даёт дыр', async () => {
    const id = await series({});
    await expect(
      txRunner.run(async (tx) => {
        const first = await numbers.next(tx, id, 'common');
        expect(first.seq).toBe(1);
        throw new Error('проба: переход отменён после выдачи');
      }),
    ).rejects.toThrow('проба');
    const after = await txRunner.run((tx) => numbers.next(tx, id, 'common'));
    expect(after.seq).toBe(1);
  });

  it('стартовое значение: первая выдача группы 1041, вторая 1042 (К3)', async () => {
    const id = await series({ startValue: 1041, template: [{ kind: 'counter' }] });
    const first = await txRunner.run((tx) => numbers.next(tx, id, 'common'));
    const second = await txRunner.run((tx) => numbers.next(tx, id, 'common'));
    expect(first).toMatchObject({ seq: 1041, display: '1041' });
    expect(second).toMatchObject({ seq: 1042, display: '1042' });
  });

  it('годовой переход: 2026 и 2027 — отдельные группы счёта (К4)', async () => {
    const id = await series({
      period: 'year',
      template: [...letterSeriesTemplate('Изм')],
    });
    const in2026 = new Date('2026-06-15T12:00:00.000Z');
    const in2027 = new Date('2026-12-31T23:30:00.000Z'); // 01.01.2027 по Минску
    // Ключ группы вычисляет вызывающий (в производстве — путь серии);
    // период-часть даёт тот же numberScopeKey: 2026 → 2027 = новая строка.
    const key2026 = numberScopeKey('year', in2026, null);
    const key2027 = numberScopeKey('year', in2027, null);
    expect(key2026).toBe('2026');
    expect(key2027).toBe('2027');
    const a1 = await txRunner.run((tx) => numbers.next(tx, id, key2026, in2026));
    const b1 = await txRunner.run((tx) => numbers.next(tx, id, key2027, in2027));
    const a2 = await txRunner.run((tx) => numbers.next(tx, id, key2026, in2026));
    expect(a1).toMatchObject({ seq: 1, year: 2026, display: 'Изм-2026/1' });
    expect(b1).toMatchObject({ seq: 1, year: 2027, display: 'Изм-2027/1' });
    expect(a2).toMatchObject({ seq: 2, display: 'Изм-2026/2' });
  });

  it('письмо-серия каталога: «Вх-ГГГГ/N» бит-в-бит, счётчик продолжается', async () => {
    const type = await fx.prisma.processType.findUnique({ where: { code: 'letter-incoming' } });
    expect(type).not.toBeNull();
    const seriesRow = await fx.prisma.numberSeries.findUnique({
      where: { code: 'letter-incoming' },
      select: { id: true, period: true, template: true },
    });
    expect(seriesRow?.period).toBe('year');
    expect(seriesRow?.template).toEqual(letterSeriesTemplate('Вх'));

    const before = await fx.prisma.numberCounter.findUnique({
      where: { seriesId_scopeKey: { seriesId: seriesRow!.id, scopeKey: '2026' } },
      select: { lastValue: true },
    });
    const at = new Date('2026-06-15T12:00:00.000Z');
    const first = await txRunner.run((tx) => numbers.nextForType(tx, type!.id, at));
    const second = await txRunner.run((tx) => numbers.nextForType(tx, type!.id, at));
    expect(first.display).toMatch(/^Вх-2026\/\d+$/);
    expect(first.seq).toBe((before?.lastValue ?? 0) + 1);
    expect(second.seq).toBe(first.seq + 1);
    expect(first.scopeKey).toBe('2026');
  });
});
