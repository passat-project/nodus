import { describe, expect, it, vi } from 'vitest';

import { assertNodeCellsWritable } from './project-structure-formulas.js';

const NODE = '22222222-2222-4222-8222-222222222222';

function setup(locked: string[]) {
  const formulaCells = { lockedFieldIds: vi.fn(async () => new Set(locked)) };
  return { formulaCells };
}

describe('assertNodeCellsWritable (#660)', () => {
  it('пустой список изменений — проверка не зовётся', async () => {
    const { formulaCells } = setup([]);
    await assertNodeCellsWritable(formulaCells, {} as never, NODE, []);
    expect(formulaCells.lockedFieldIds).not.toHaveBeenCalled();
  });

  it('формульный ключ — 422 FORMULA_CELL_LOCKED с перечнем', async () => {
    const { formulaCells } = setup(['f-1']);
    await expect(
      assertNodeCellsWritable(formulaCells, {} as never, NODE, [
        { fieldId: 'f-1', from: null, to: 'x' },
      ]),
    ).rejects.toMatchObject({ code: 'FORMULA_CELL_LOCKED', details: { fields: ['f-1'] } });
    expect(formulaCells.lockedFieldIds).toHaveBeenCalledWith(expect.anything(), 'node', NODE, [
      'f-1',
    ]);
  });

  it('без блокировки — тихо', async () => {
    const { formulaCells } = setup([]);
    await assertNodeCellsWritable(formulaCells, {} as never, NODE, [
      { fieldId: 'f-2', from: null, to: 'x' },
    ]);
  });
});
