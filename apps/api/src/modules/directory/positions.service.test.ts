import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionsService } from './positions.service.js';

function position(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pos-1',
    name: 'Инженер-проектировщик',
    kind: 'legal',
    sortOrder: 7,
    ...overrides,
  };
}

describe('PositionsService', () => {
  const positions = {
    findAllByKind: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    lockForUpdate: vi.fn(),
    lockMany: vi.fn(),
    countHolders: vi.fn(),
    reassignHolders: vi.fn(),
  };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: PositionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    positions.lockMany.mockResolvedValue(undefined);
    positions.lockForUpdate.mockResolvedValue(true);
    positions.remove.mockResolvedValue(undefined);
    positions.findById.mockResolvedValue(position({ kind: 'management' }));
    positions.findByName.mockResolvedValue(null);
    service = new PositionsService(positions as never, tx as never, eventBus as never);
  });

  it('список должностей вида — без фильтра архива: архива больше нет', async () => {
    positions.findAllByKind.mockResolvedValue([position()]);

    const list = await service.list('management');

    expect(positions.findAllByKind).toHaveBeenCalledWith('management');
    expect(list).toHaveLength(1);
  });

  it('переименование пишет только присланное поле: вид и порядок сохраняются (#492)', async () => {
    positions.findById.mockResolvedValue(position());
    positions.update.mockResolvedValue(position({ name: 'ГИП' }));

    const updated = await service.update('pos-1', { name: 'ГИП' }, 'admin-1');

    // В репозиторий уходит ровно присланное — без подставленных kind/sortOrder.
    expect(positions.update).toHaveBeenCalledWith('pos-1', { name: 'ГИП' }, 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.position.updated',
      { positionId: 'pos-1', changedFields: ['name'] },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
    expect(updated.kind).toBe('legal');
    expect(updated.sortOrder).toBe(7);
  });

  it('изменение порядка — только этот ключ в changedFields (вид неизменяем, #441)', async () => {
    positions.findById.mockResolvedValue(position());
    positions.update.mockResolvedValue(position({ sortOrder: 1 }));

    await service.update('pos-1', { sortOrder: 1 }, 'admin-1');

    expect(positions.update).toHaveBeenCalledWith('pos-1', { sortOrder: 1 }, 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.position.updated',
      { positionId: 'pos-1', changedFields: ['sortOrder'] },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
  });

  it('отсутствующая должность → NOT_FOUND, без записи и события', async () => {
    positions.findById.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'X' }, 'admin-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(positions.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  describe('создание должности (#768, вердикт 17.11.2026)', () => {
    it('свободное имя — создаёт строку и пишет событие created', async () => {
      positions.create.mockResolvedValue(
        position({ id: 'pos-9', name: 'Архитектор', kind: 'management' }),
      );

      const created = await service.create(
        { name: 'Архитектор', kind: 'management', sortOrder: 0 },
        'admin-1',
      );

      expect(positions.create).toHaveBeenCalledWith(
        { name: 'Архитектор', kind: 'management', sortOrder: 0 },
        'tx-handle',
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.position.created',
        { positionId: 'pos-9', kind: 'management' },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
      expect(created.id).toBe('pos-9');
    });

    it('существующая должность с тем же именем → DIRECTORY_POSITION_EXISTS, без вставки', async () => {
      positions.findByName.mockResolvedValue(position({ id: 'pos-1' }));

      await expect(
        service.create({ name: 'Инженер', kind: 'management', sortOrder: 0 }, 'admin-1'),
      ).rejects.toMatchObject({
        code: 'DIRECTORY_POSITION_EXISTS',
        details: { positionId: 'pos-1' },
      });
      expect(positions.create).not.toHaveBeenCalled();
      expect(positions.update).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('имя удалённой должности снова свободно — создаётся НОВАЯ строка', async () => {
      // Жёсткое удаление: строка исчезла, findByName её не находит — обычное создание.
      positions.findByName.mockResolvedValue(null);
      positions.create.mockResolvedValue(
        position({ id: 'pos-2', name: 'Инженер', kind: 'management' }),
      );

      const created = await service.create(
        { name: 'Инженер', kind: 'management', sortOrder: 0 },
        'admin-1',
      );

      expect(positions.create).toHaveBeenCalled();
      expect(positions.update).not.toHaveBeenCalled();
      expect(created.id).toBe('pos-2');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.position.created',
        { positionId: 'pos-2', kind: 'management' },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });
  });

  it('переименование в занятое имя → DIRECTORY_POSITION_EXISTS, без записи', async () => {
    positions.findById.mockResolvedValue(position({ id: 'pos-1', kind: 'management' }));
    positions.findByName.mockResolvedValue(
      position({ id: 'pos-2', kind: 'management', name: 'ГИП' }),
    );

    await expect(service.update('pos-1', { name: 'ГИП' }, 'admin-1')).rejects.toMatchObject({
      code: 'DIRECTORY_POSITION_EXISTS',
      details: { positionId: 'pos-2' },
    });
    expect(positions.update).not.toHaveBeenCalled();
  });

  it('переименование в своё же имя — не дубль', async () => {
    positions.findById.mockResolvedValue(position({ id: 'pos-1', kind: 'management' }));
    positions.findByName.mockResolvedValue(
      position({ id: 'pos-1', kind: 'management', name: 'Инженер-проектировщик' }),
    );
    positions.update.mockResolvedValue(position({ id: 'pos-1' }));

    await service.update('pos-1', { name: 'Инженер-проектировщик' }, 'admin-1');

    expect(positions.update).toHaveBeenCalledWith(
      'pos-1',
      { name: 'Инженер-проектировщик' },
      'tx-handle',
    );
  });

  it('имя удалённой должности при переименовании не занято — успех', async () => {
    positions.findById.mockResolvedValue(position({ id: 'pos-1', kind: 'management' }));
    positions.findByName.mockResolvedValue(null);
    positions.update.mockResolvedValue(position({ id: 'pos-1', name: 'Архитектор' }));

    await service.update('pos-1', { name: 'Архитектор' }, 'admin-1');

    expect(positions.update).toHaveBeenCalledWith('pos-1', { name: 'Архитектор' }, 'tx-handle');
  });

  describe('удаление должности (#768, жёсткое)', () => {
    it('есть сотрудники (включая уволенных) → 409 holders, строка не трогается', async () => {
      positions.countHolders.mockResolvedValue(3);

      await expect(service.delete('pos-1', 'admin-1')).rejects.toMatchObject({
        code: 'DIRECTORY_POSITION_IN_USE',
        details: { positionId: 'pos-1', reason: 'holders', holders: 3 },
      });
      expect(positions.remove).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('нет сотрудников → строка удаляется, событие position.deleted', async () => {
      positions.countHolders.mockResolvedValue(0);

      await service.delete('pos-1', 'admin-1');

      expect(positions.lockForUpdate).toHaveBeenCalledWith('pos-1', 'tx-handle');
      expect(positions.remove).toHaveBeenCalledWith('pos-1', 'tx-handle');
      expect(positions.update).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.position.deleted',
        { positionId: 'pos-1', kind: 'management' },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });

    it('строку забрал конкурент → NOT_FOUND, без удаления и события', async () => {
      positions.lockForUpdate.mockResolvedValue(false);

      await expect(service.delete('pos-1', 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(positions.remove).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('повторное удаление (строки уже нет) → NOT_FOUND, без события', async () => {
      positions.findById.mockResolvedValue(null);

      await expect(service.delete('pos-1', 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(positions.remove).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('переназначение сотрудников (#768)', () => {
    it('переводит всех сотрудников, включая уволенных, на должность того же вида', async () => {
      positions.findById.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'pos-1'
            ? position({ id: 'pos-1', kind: 'management' })
            : position({ id: 'pos-2', kind: 'management', name: 'ГИП' }),
        ),
      );
      positions.reassignHolders.mockResolvedValue(4);

      await service.reassign('pos-1', { targetId: 'pos-2' }, 'admin-1');

      expect(positions.lockMany).toHaveBeenCalledWith(['pos-1', 'pos-2'], 'tx-handle');
      expect(positions.reassignHolders).toHaveBeenCalledWith(
        'pos-1',
        'pos-2',
        'management',
        'tx-handle',
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.position.updated',
        {
          positionId: 'pos-1',
          changedFields: ['holders'],
          targetId: 'pos-2',
          reassigned: 4,
        },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });

    it('та же должность → DIRECTORY_REFERENCE_INVALID self', async () => {
      await expect(
        service.reassign('pos-1', { targetId: 'pos-1' }, 'admin-1'),
      ).rejects.toMatchObject({
        code: 'DIRECTORY_REFERENCE_INVALID',
        details: { field: 'targetId', reason: 'self' },
      });
      expect(positions.reassignHolders).not.toHaveBeenCalled();
    });

    it('исходной должности нет → NOT_FOUND, без захватов', async () => {
      positions.findById.mockResolvedValue(null);

      await expect(
        service.reassign('pos-1', { targetId: 'pos-2' }, 'admin-1'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(positions.lockMany).not.toHaveBeenCalled();
      expect(positions.reassignHolders).not.toHaveBeenCalled();
    });

    it('целевая должность другого вида → kind_mismatch', async () => {
      positions.findById.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'pos-1'
            ? position({ id: 'pos-1', kind: 'management' })
            : position({ id: 'pos-2', kind: 'legal' }),
        ),
      );

      await expect(
        service.reassign('pos-1', { targetId: 'pos-2' }, 'admin-1'),
      ).rejects.toMatchObject({
        code: 'DIRECTORY_REFERENCE_INVALID',
        details: { field: 'targetId', reason: 'kind_mismatch' },
      });
      expect(positions.reassignHolders).not.toHaveBeenCalled();
    });

    it('несуществующая целевая должность → not_found', async () => {
      positions.findById.mockImplementation((id: string) =>
        Promise.resolve(id === 'pos-1' ? position({ id: 'pos-1' }) : null),
      );

      await expect(
        service.reassign('pos-1', { targetId: 'missing' }, 'admin-1'),
      ).rejects.toMatchObject({
        code: 'DIRECTORY_REFERENCE_INVALID',
        details: { field: 'targetId', reason: 'not_found' },
      });
    });
  });
});
