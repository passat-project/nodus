import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../../generated/prisma/client.js';
import { DefinitionsRepository } from './definitions.repository.js';

/**
 * Репозиторий `field_definitions` (#631): реестр один на портал, привязки
 * `field_bindings` по видам целей (bind/unbind/replace/sync — идемпотентны),
 * значение глобальной переменной — upsert одной строки, умолчание в update
 * различает «не менять» и «очистить» (DbNull).
 */

const ID = '00000000-0000-4000-8000-0000000000c1';
const T1 = '00000000-0000-4000-8000-0000000000c2';
const T2 = '00000000-0000-4000-8000-0000000000c3';

function make() {
  const db = {
    fieldDefinition: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    fieldBinding: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    companyValue: { deleteMany: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  const repo = new DefinitionsRepository(db as never);
  return { repo, db, tx: db };
}

describe('DefinitionsRepository: реестр (#631)', () => {
  it('list/findById/countAll — без tx на PrismaService, строки как есть', async () => {
    const { repo, db } = make();
    db.fieldDefinition.findMany.mockResolvedValueOnce([{ id: ID }]);
    expect(await repo.list()).toEqual([{ id: ID }]);
    expect(db.fieldDefinition.findMany).toHaveBeenCalledWith({
      select: expect.anything(),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    db.fieldDefinition.findUnique.mockResolvedValueOnce({ id: ID });
    expect(await repo.findById(ID)).toEqual({ id: ID });

    db.fieldDefinition.count.mockResolvedValueOnce(7);
    expect(await repo.countAll()).toBe(7);
  });

  it('findByName — первая занявшая строка или null; maxSortOrder — -1 при пустоте', async () => {
    const { repo, db } = make();
    db.$queryRaw.mockResolvedValueOnce([{ id: ID, name: 'Марка' }]);
    expect(await repo.findByName('марка', null)).toEqual({ id: ID, name: 'Марка' });
    db.$queryRaw.mockResolvedValueOnce([]);
    expect(await repo.findByName('свободно', ID)).toBeNull();

    db.fieldDefinition.aggregate.mockResolvedValueOnce({ _max: { sortOrder: null } });
    expect(await repo.maxSortOrder()).toBe(-1);
    db.fieldDefinition.aggregate.mockResolvedValueOnce({ _max: { sortOrder: 4 } });
    expect(await repo.maxSortOrder()).toBe(4);
  });

  it('nextNumber — sequence внутри транзакции создания', async () => {
    const { repo, tx } = make();
    tx.$queryRaw.mockResolvedValueOnce([{ n: 41 }]);
    expect(await repo.nextNumber(tx as never)).toBe(41);
  });

  it('update: умолчание — не менять (нет ключа), null — очистить (DbNull), значение — писать', async () => {
    const { repo, tx } = make();
    tx.fieldDefinition.update.mockResolvedValue({ id: ID });
    await repo.update(ID, { name: 'Марка' }, tx as never);
    expect(tx.fieldDefinition.update).toHaveBeenLastCalledWith({
      where: { id: ID },
      data: { name: 'Марка' },
      select: expect.anything(),
    });

    await repo.update(ID, { defaultValue: null }, tx as never);
    expect(tx.fieldDefinition.update).toHaveBeenLastCalledWith({
      where: { id: ID },
      data: { defaultValue: Prisma.DbNull },
      select: expect.anything(),
    });

    await repo.update(ID, { defaultValue: { kind: 'static', value: 'x' } }, tx as never);
    expect(tx.fieldDefinition.update).toHaveBeenLastCalledWith({
      where: { id: ID },
      data: { defaultValue: { kind: 'static', value: 'x' } },
      select: expect.anything(),
    });
  });

  it('remove — удаление всегда разрешено (каскадом)', async () => {
    const { repo, tx } = make();
    await repo.remove(ID, tx as never);
    expect(tx.fieldDefinition.delete).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('create: умолчание null записывается как DbNull', async () => {
    const { repo, tx } = make();
    tx.fieldDefinition.create.mockResolvedValueOnce({ id: ID });
    await repo.create({ name: 'Марка', defaultValue: null } as never, tx as never);

    expect(tx.fieldDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Марка', defaultValue: Prisma.DbNull }),
      select: expect.anything(),
    });
  });
});

describe('DefinitionsRepository: привязки field_bindings (Р3/Р10 #631)', () => {
  it('bindTarget — идемпотентный upsert по составному ключу', async () => {
    const { repo, tx } = make();
    await repo.bindTarget(ID, 'project_type', T1, tx as never);
    expect(tx.fieldBinding.upsert).toHaveBeenCalledWith({
      where: {
        definitionId_targetKind_targetId: {
          definitionId: ID,
          targetKind: 'project_type',
          targetId: T1,
        },
      },
      update: {},
      create: { definitionId: ID, targetKind: 'project_type', targetId: T1 },
    });
  });

  it('unbindTarget — true/false по числу снятых', async () => {
    const { repo, tx } = make();
    tx.fieldBinding.deleteMany.mockResolvedValueOnce({ count: 1 });
    expect(await repo.unbindTarget(ID, 'node_kind', T1, tx as never)).toBe(true);
    tx.fieldBinding.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.unbindTarget(ID, 'node_kind', T1, tx as never)).toBe(false);
  });

  it('replaceTargets: пустой набор — только зачистка; с набором — зачистка чужих + createMany', async () => {
    const { repo, tx } = make();
    await repo.replaceTargets(ID, 'process_type', [], tx as never);
    expect(tx.fieldBinding.deleteMany).toHaveBeenLastCalledWith({
      where: { definitionId: ID, targetKind: 'process_type' },
    });
    expect(tx.fieldBinding.createMany).not.toHaveBeenCalled();

    await repo.replaceTargets(ID, 'process_type', [T1, T2], tx as never);
    expect(tx.fieldBinding.deleteMany).toHaveBeenLastCalledWith({
      where: { definitionId: ID, targetKind: 'process_type', targetId: { notIn: [T1, T2] } },
    });
    expect(tx.fieldBinding.createMany).toHaveBeenCalledWith({
      data: [
        { definitionId: ID, targetKind: 'process_type', targetId: T1 },
        { definitionId: ID, targetKind: 'process_type', targetId: T2 },
      ],
      skipDuplicates: true,
    });
  });

  it('syncTargets: добавленные слоты привязывают, снятые — снимают, привязки без слотов живут', async () => {
    const { repo, db, tx } = make();
    // Без tx — на PrismaService, с tx — на транзакции записи формы.
    await repo.syncTargets('project_type', T1, [ID], []);
    expect(db.fieldBinding.deleteMany).not.toHaveBeenCalled();
    expect(db.fieldBinding.createMany).toHaveBeenCalledWith({
      data: [{ definitionId: ID, targetKind: 'project_type', targetId: T1 }],
      skipDuplicates: true,
    });

    db.fieldBinding.createMany.mockClear();
    await repo.syncTargets('node_kind', T1, [], [ID], tx as never);
    expect(tx.fieldBinding.deleteMany).toHaveBeenCalledWith({
      where: { targetKind: 'node_kind', targetId: T1, definitionId: { in: [ID] } },
    });
    expect(tx.fieldBinding.createMany).not.toHaveBeenCalled();
  });
});

describe('DefinitionsRepository: глобальные переменные и порядок (Р1/Р2 #631)', () => {
  it('putCompanyValue: значение — upsert одной строки, null — строка удаляется', async () => {
    const { repo, tx } = make();
    const value = { kind: 'static', value: '2026' } as never;
    await repo.putCompanyValue(ID, value, 'u1', tx as never);
    expect(tx.companyValue.upsert).toHaveBeenCalledWith({
      where: { definitionId: ID },
      update: { value, updatedById: 'u1', updatedAt: expect.any(Date) },
      create: { definitionId: ID, value, updatedById: 'u1' },
    });

    await repo.putCompanyValue(ID, null, 'u1', tx as never);
    expect(tx.companyValue.deleteMany).toHaveBeenCalledWith({ where: { definitionId: ID } });
  });

  it('applyOrder: пусто — нет UPDATE; порядок — одним запросом', async () => {
    const { repo, tx } = make();
    await repo.applyOrder([], tx as never);
    expect(tx.$executeRaw).not.toHaveBeenCalled();

    await repo.applyOrder([ID, T1], tx as never);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('lockRegistry — advisory-лок одним ключом на портал', async () => {
    const { repo, tx } = make();
    await repo.lockRegistry(tx as never);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
