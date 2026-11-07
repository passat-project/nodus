import { describe, expect, it, vi } from 'vitest';

import { FormulaMetaService, metaOf } from './formula-meta.service.js';

/** Снимок реестра для формул (#632, Р2/Р6): один запрос на операцию, кэш
 *  по транзакции (формулы не меняют реестр в той же tx), формулы мест —
 *  по привязкам с defaultFormula, мета тайпинга — номер/тип/справочник. */

const ROW_A = {
  id: '35560000-0000-4000-8000-000000000081',
  number: 1,
  type: 'number',
  settings: {},
  bindings: [],
};
const ROW_B = {
  id: '35560000-0000-4000-8000-000000000082',
  number: 2,
  type: 'multienum',
  settings: { dictionaryId: 'dict-1' },
  bindings: [
    { targetId: 'place-1', defaultFormula: { kind: 'literal', value: 1 } },
    { targetId: 'place-2', defaultFormula: null },
  ],
};

function service(rows: unknown[]) {
  return new FormulaMetaService({ list: vi.fn(async () => rows) } as never);
}

describe('FormulaMetaService.snapshot (#632, Р2/Р6)', () => {
  it('формулы мест собираются по привязкам с defaultFormula', async () => {
    const snapshot = await service([ROW_A, ROW_B]).snapshot();
    expect(snapshot.byNumber.get(2)?.id).toBe(ROW_B.id);
    expect(snapshot.byId.get(ROW_B.id)?.number).toBe(2);
    expect(snapshot.bindingFormulas.get('place-1')).toEqual([
      { definitionId: ROW_B.id, ast: { kind: 'literal', value: 1 } },
    ]);
    expect(snapshot.bindingFormulas.has('place-2')).toBe(false);
    expect(snapshot.bindingFormulas.size).toBe(1);
  });

  it('кэш по транзакции: один list на tx, без tx — каждый раз новый', async () => {
    const svc = service([ROW_A]);
    const tx = { key: 1 } as never;
    const first = await svc.snapshot(tx);
    const second = await svc.snapshot(tx);
    expect(first).toBe(second);
    await svc.snapshot();
    await svc.snapshot();
    expect(
      (svc as unknown as { repo: { list: ReturnType<typeof vi.fn> } }).repo.list,
    ).toHaveBeenCalledTimes(3);
  });
});

describe('metaOf: мета тайпинга (#632, Р2)', () => {
  it('номер/тип/справочник; без справочника — null', () => {
    const meta = metaOf([ROW_A, ROW_B] as never);
    expect(meta.byNumber.get(1)).toEqual({ number: 1, type: 'number', dictionaryId: null });
    expect(meta.byNumber.get(2)?.dictionaryId).toBe('dict-1');
  });
});
