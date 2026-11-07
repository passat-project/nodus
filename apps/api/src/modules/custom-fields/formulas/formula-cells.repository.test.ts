import { describe, expect, it, vi } from 'vitest';

import { FormulaCellsRepository } from './formula-cells.repository.js';

/** Доступ к formula_cells/formula_deps (#632, Р1/Р4): пустые наборы не ходят
 *  в БД, deps переписываются delete+create, префикс — диапазоном ключей
 *  (btree без LIKE, A3-05), ячейки зависимостей дедуплицируются. */

const CELL = { id: 'cell-1', hostKind: 'task', hostId: 'h1', fieldId: 'f1' };

function prismaStub(rows: { dep?: unknown[]; cell?: unknown[] } = {}) {
  return {
    formulaCell: {
      findMany: vi.fn(async () => rows.cell ?? []),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'new-cell' })),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 2),
    },
    formulaDep: {
      findMany: vi.fn(async () => rows.dep ?? []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
    },
    fieldDefinition: { findUnique: vi.fn(async () => ({ number: 7 })) },
    fieldBinding: { count: vi.fn(async () => 3) },
  };
}

function repoWith(rows?: Parameters<typeof prismaStub>[0]) {
  const prisma = prismaStub(rows);
  const repo = new FormulaCellsRepository(prisma as never);
  return { repo, prisma };
}

describe('FormulaCellsRepository: ячейки хостов (#632, Р1)', () => {
  it('пустой список хостов — без запроса', async () => {
    const { repo } = repoWith();
    await expect(repo.listByHosts('task', [])).resolves.toEqual([]);
  });

  it('upsert возвращает id новой ячейки; состояние пишет с DbNull для null-ошибки', async () => {
    const { repo, prisma } = repoWith();
    await expect(
      repo.upsert(prisma as never, {
        hostKind: 'task',
        hostId: 'h1',
        fieldId: 'f1',
        ast: { kind: 'literal', value: 1 },
        createdById: null,
      }),
    ).resolves.toBe('new-cell');
    await repo.updateState(prisma as never, 'cell-1', { error: null, depth: 2 });
    const updateArg = prisma.formulaCell.update.mock.calls[0][0];
    expect(updateArg.data.recalcDepth).toBe(2);
    expect(String(updateArg.data.error)).toContain('DbNull');
  });

  it('removeMany без полей и replaceDeps без ключей — только deleteMany', async () => {
    const { repo, prisma } = repoWith();
    await repo.removeMany(prisma as never, 'task', 'h1', []);
    expect(prisma.formulaCell.deleteMany).not.toHaveBeenCalled();
    await repo.replaceDeps(prisma as never, 'cell-1', []);
    expect(prisma.formulaDep.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.formulaDep.createMany).not.toHaveBeenCalled();
  });
});

describe('FormulaCellsRepository: зависимости (#632, Р4/A3-05)', () => {
  it('пустые ключи — без запроса; дубликаты ячеек схлопываются', async () => {
    const { repo } = repoWith({ dep: [{ cell: CELL }, { cell: CELL }] });
    await expect(repo.byDepKeys([])).resolves.toEqual([]);
    const refs = await repo.byDepKeys(['v:task:h1:1']);
    expect(refs).toEqual([
      { cellId: CELL.id, hostKind: 'task', hostId: CELL.hostId, fieldId: CELL.fieldId },
    ]);
  });

  it('префикс — диапазоном gte/lt, не LIKE', async () => {
    const { repo, prisma } = repoWith({ dep: [] });
    await repo.byDepPrefix('v:task:h1:');
    const where = prisma.formulaDep.findMany.mock.calls[0][0].where;
    expect(where.depKey.gte).toBe('v:task:h1:');
    expect(where.depKey.lt).toBe('v:task:h1:\uFFFF');
  });

  it('номер определения и счётчики usage', async () => {
    const { repo } = repoWith();
    await expect(repo.findNumberById('def-1')).resolves.toBe(7);
    await expect(repo.countByFieldId('def-1')).resolves.toBe(2);
    await expect(repo.countTypeDefaults('def-1')).resolves.toBe(3);
    await expect(repo.countByAttrNumber(7)).resolves.toBe(1);
  });
});
