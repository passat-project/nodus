import { describe, expect, it, vi } from 'vitest';

import { PositionsController } from './positions.controller.js';

/** Тонкий контроллер должностей (#768): тела новых мутаций делегируют сервису. */
describe('PositionsController', () => {
  const service = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reassign: vi.fn(),
    delete: vi.fn(),
  };
  const controller = new PositionsController(service as never);
  const actor = { id: 'admin-1' } as never;

  it('переназначение и удаление делегируют сервису с актором', async () => {
    service.reassign.mockResolvedValue(undefined);
    service.delete.mockResolvedValue(undefined);

    await controller.reassign('p-1', { targetId: 'p-2' }, actor);
    expect(service.reassign).toHaveBeenCalledWith('p-1', { targetId: 'p-2' }, 'admin-1');

    await controller.delete('p-1', actor);
    expect(service.delete).toHaveBeenCalledWith('p-1', 'admin-1');
  });
});
