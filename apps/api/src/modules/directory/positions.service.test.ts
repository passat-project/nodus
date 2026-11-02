import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionsService } from './positions.service.js';

function position(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pos-1',
    name: 'Инженер-проектировщик',
    kind: 'legal',
    sortOrder: 7,
    isActive: true,
    ...overrides,
  };
}

describe('PositionsService', () => {
  const positions = {
    findAllByKind: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: PositionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PositionsService(positions as never, tx as never, eventBus as never);
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
});
