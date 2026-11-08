import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionRunner } from '../../src/core/database/transaction-runner.js';
import { NumberSeriesService } from '../../src/modules/workflows/numbering/number-series.service.js';
import { letterSeriesTemplate } from '../../src/modules/workflows/numbering/number-template.js';
import { setupChatFixture, type ChatTestFixture } from './chat-fixtures.js';

/**
 * Серии номеров на реальном PostgreSQL (#630): инварианты хранилища
 * «контейнер × период». Юниты не видят главного риска — атомарности upsert
 * и отката транзакции. Здесь живые транзакции: 8 параллельных выдач одного
 * контейнера — без дублей и потерь; две папки — независимые счета (Кейс A);
 * откат tx — счётчик не сдвинулся; «следующий номер» только вперёд и только
 * для текущего года (Кейс D: старт 15 в 2026, 2027 — с 1); журнал выдач.
 * Письмо-путь (`nextForType`) — на сид-серии каталога: «Вх-ГГГГ/N» бит-в-бит.
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

  /** Серия прогона с уникальным code (уборка по id; журнал — каскадом). */
  async function series(data: {
    template?: unknown;
    period?: string;
    startValue?: number;
    containerKind?: string;
    containerRef?: string;
  }): Promise<string> {
    const row = await fx.prisma.numberSeries.create({
      data: {
        code: `test-${fx.runId}-${seriesIds.length}`,
        prefix: 'Т',
        name: `Проба ${fx.runId}`,
        containerKind: data.containerKind ?? 'company',
        containerRef: data.containerRef ?? null,
        period: data.period ?? 'none',
        template: (data.template ?? [{ kind: 'counter' }]) as never,
        startValue: data.startValue ?? 1,
      },
      select: { id: true },
    });
    seriesIds.push(row.id);
    return row.id;
  }

  const IZM = [{ kind: 'literal', text: 'Изм. ' }, { kind: 'counter' }];
  const BOOK = [{ kind: 'counter' }, { kind: 'literal', text: '-' }, { kind: 'year', digits: 2 }];

  it('8 параллельных выдач в одной папке: seq без дублей и потерь (К6)', async () => {
    const id = await series({ template: IZM, containerKind: 'folder', containerRef: randomUUID() });
    const folder = randomUUID();
    const issued = await Promise.all(
      Array.from({ length: 8 }, () =>
        txRunner.run((tx) => numbers.next(tx, id, { containerId: folder })),
      ),
    );
    expect(issued.map((n) => n.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(issued.map((n) => n.display)).size).toBe(8);
  });

  it('Кейс A: КЖ-01 → Изм. 1, Изм. 2; КЖ-02 → Изм. 1 — независимые счета', async () => {
    const id = await series({ template: IZM, containerKind: 'folder', containerRef: randomUUID() });
    const kzh01 = randomUUID();
    const kzh02 = randomUUID();
    const a1 = await txRunner.run((tx) => numbers.next(tx, id, { containerId: kzh01 }));
    const b1 = await txRunner.run((tx) => numbers.next(tx, id, { containerId: kzh02 }));
    const a2 = await txRunner.run((tx) => numbers.next(tx, id, { containerId: kzh01 }));
    expect([a1.display, b1.display, a2.display]).toEqual(['Изм. 1', 'Изм. 1', 'Изм. 2']);
    const counters = await fx.prisma.numberCounter.findMany({
      where: { seriesId: id },
      select: { containerId: true, lastValue: true, periodKey: true },
      orderBy: { lastValue: 'asc' },
    });
    expect(counters).toEqual([
      { containerId: kzh02, lastValue: 1, periodKey: '' },
      { containerId: kzh01, lastValue: 2, periodKey: '' },
    ]);
  });

  it('откат транзакции не сдвигает счётчик и не пишет журнал', async () => {
    const id = await series({});
    const host = { kind: 'task' as const, id: randomUUID(), fieldId: null, actorId: null };
    await expect(
      txRunner.run(async (tx) => {
        const first = await numbers.next(tx, id, { containerId: null, host });
        expect(first.seq).toBe(1);
        throw new Error('проба: переход отменён после выдачи');
      }),
    ).rejects.toThrow('проба');
    const after = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null, host }));
    expect(after.seq).toBe(1);
    expect(await fx.prisma.numberAssignment.count({ where: { seriesId: id } })).toBe(1);
  });

  it('Кейс C: следующий номер 1041 общего счёта → 1041, 1042; назад — 409', async () => {
    const id = await series({});
    await txRunner.run((tx) => numbers.setNext(tx, id, { containerId: null, nextValue: 1041 }));
    const first = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null }));
    const second = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null }));
    expect([first.display, second.display]).toEqual(['1041', '1042']);
    await expect(
      txRunner.run((tx) => numbers.setNext(tx, id, { containerId: null, nextValue: 1042 })),
    ).rejects.toMatchObject({ code: 'NUMBER_NEXT_BACKWARDS' });
    // Ровно «следующий» — допустимо (без изменений), вперёд — сдвигает.
    await txRunner.run((tx) => numbers.setNext(tx, id, { containerId: null, nextValue: 1043 }));
    await txRunner.run((tx) => numbers.setNext(tx, id, { containerId: null, nextValue: 1050 }));
    const third = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null }));
    expect(third.seq).toBe(1050);
  });

  it('Кейс D: книга «15-26» продолжается с 15 только в 2026; 2027 — с 1', async () => {
    const id = await series({ template: BOOK, period: 'year' });
    const in2026 = new Date('2026-06-15T12:00:00.000Z');
    const in2027 = new Date('2026-12-31T23:30:00.000Z'); // 01.01.2027 по Минску
    await txRunner.run((tx) =>
      numbers.setNext(tx, id, { containerId: null, nextValue: 15, at: in2026 }),
    );
    const a = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null, at: in2026 }));
    const b = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null, at: in2026 }));
    const c = await txRunner.run((tx) => numbers.next(tx, id, { containerId: null, at: in2027 }));
    expect([a.display, b.display, c.display]).toEqual(['15-26', '16-26', '1-27']);
    expect(c).toMatchObject({ scopeKey: '2027', periodKey: '2027', year: 2027 });
  });

  it('новая папка начинается со старта правила; журнал помнит контейнер', async () => {
    const id = await series({
      template: IZM,
      startValue: 5,
      containerKind: 'folder',
      containerRef: randomUUID(),
    });
    const folder = randomUUID();
    const taskId = randomUUID();
    const fieldId = randomUUID();
    const issued = await txRunner.run((tx) =>
      numbers.next(tx, id, {
        containerId: folder,
        host: { kind: 'task', id: taskId, fieldId, actorId: null },
      }),
    );
    expect(issued.display).toBe('Изм. 5');
    const journal = await fx.prisma.numberAssignment.findMany({ where: { seriesId: id } });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      containerId: folder,
      hostKind: 'task',
      hostId: taskId,
      fieldId,
      seq: 5,
      display: 'Изм. 5',
    });
    expect(await numbers.issuedCount(fx.prisma as never, id)).toBe(1);
  });

  it('письмо-серия каталога: «Вх-ГГГГ/N» бит-в-бит, счётчик продолжается', async () => {
    const type = await fx.prisma.processType.findUnique({ where: { code: 'letter-incoming' } });
    expect(type).not.toBeNull();
    const seriesRow = await fx.prisma.numberSeries.findUnique({
      where: { code: 'letter-incoming' },
      select: { id: true, period: true, template: true, containerKind: true },
    });
    expect(seriesRow).toMatchObject({ period: 'year', containerKind: 'company' });
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
    expect(first).toMatchObject({ scopeKey: '2026', containerId: null, periodKey: '2026' });
  });
});
