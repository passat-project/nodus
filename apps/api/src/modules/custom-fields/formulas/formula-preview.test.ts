import { describe, expect, it, vi } from 'vitest';

import { previewCells } from './formula-preview.js';

/** Dry-run переноса (move-preview, Р10): свои ячейки и формулы места «до/после»
 *  подмены места, ничего не пишет; неизменившиеся значения в дифф не едут,
 *  ошибка расчёта — to=null без блокировки (Р13). */

const HOST = '21000000-0000-4000-8000-000000000011';
const FIELD = '35560000-0000-4000-8000-000000000011';
const PLACE = 'place-11';
const AST = { kind: 'literal', value: 1 } as const;
const BEFORE_RESOLVER = { marker: 'before' };
const AFTER_RESOLVER = { marker: 'after' };

function deps(
  over: {
    cells?: { hostId: string; fieldId: string; ast: unknown }[];
    record?: Record<string, unknown> | null;
    placeFormulas?: { definitionId: string; ast: unknown }[];
    beforeValues?: Record<string, unknown>;
    afterByField?: Record<string, unknown>;
  } = {},
) {
  const byId = new Map([[FIELD, { type: 'number', name: 'Шифр' }]] as const);
  const snapshot = {
    meta: { byNumber: new Map() },
    byNumber: new Map(),
    byId,
    bindingFormulas: new Map([[PLACE, over.placeFormulas ?? []]]),
  };
  const repo = { listByHosts: vi.fn(async () => over.cells ?? []) };
  const meta = { snapshot: vi.fn(async () => snapshot) };
  const base = {
    placeId: PLACE,
    values: { [FIELD]: 1 },
    system: { title: 'Комплект', number: 5 },
    id: HOST,
  };
  const context = {
    record: vi.fn(async () => (over.record === undefined ? base : over.record)),
    build: vi.fn(async (args: { override?: unknown }) => ({
      resolver: args.override ? AFTER_RESOLVER : BEFORE_RESOLVER,
      overflowed: false,
      host: { values: args.override ? {} : (over.beforeValues ?? { [FIELD]: 1 }) },
    })),
  };
  const values = { materialize: vi.fn(async (_def: unknown, value: unknown) => value) };
  const engine = {
    evaluate: vi.fn((_ast: unknown, resolver: { marker: string }) => ({
      value: resolver.marker === 'after' ? 2 : 1,
      error: null,
    })),
  };
  return {
    deps: { repo, meta, context, values, engine } as never,
    repo,
    context,
    engine,
  };
}

describe('previewCells: dry-run переноса (#632, Р10)', () => {
  it('пустой список хостов — без работы', async () => {
    const d = deps();
    const entries = await previewCells(d.deps, 'task', [], { kind: 'node', nodeId: 'n' });
    expect(entries).toEqual([]);
    expect(d.repo.listByHosts).not.toHaveBeenCalled();
  });

  it('своё значение изменилось — строка диффа с подписью записи и было/станет', async () => {
    const d = deps({ cells: [{ hostId: HOST, fieldId: FIELD, ast: AST }] });
    const entries = await previewCells(d.deps, 'task', [HOST], { kind: 'node', nodeId: 'n' });
    expect(entries).toEqual([
      {
        hostKind: 'task',
        hostId: HOST,
        fieldId: FIELD,
        hostLabel: '#5 Комплект',
        fieldName: 'Шифр',
        from: 1,
        to: 2,
      },
    ]);
  });

  it('неизменившееся значение в дифф не попадает; ошибка расчёта — to=null', async () => {
    const same = deps({ cells: [{ hostId: HOST, fieldId: FIELD, ast: AST }] });
    same.engine.evaluate.mockReturnValue({ value: 1, error: null });
    const entries = await previewCells(same.deps, 'task', [HOST], { kind: 'node', nodeId: 'n' });
    expect(entries).toEqual([]);

    const broken = deps({ cells: [{ hostId: HOST, fieldId: FIELD, ast: AST }] });
    broken.engine.evaluate.mockReturnValue({
      value: null,
      error: { code: 'cycle', message: 'цикл' },
    });
    const withError = await previewCells(broken.deps, 'task', [HOST], {
      kind: 'node',
      nodeId: 'n',
    });
    expect(withError).toEqual([expect.objectContaining({ fieldId: FIELD, from: 1, to: null })]);
  });

  it('формула места считается до/после; своя ячейка и значение подавляют её', async () => {
    const d = deps({
      placeFormulas: [{ definitionId: FIELD, ast: AST }],
      cells: [],
    });
    d.context.record.mockResolvedValue({
      placeId: PLACE,
      values: {},
      system: { name: 'Здание 1' },
      id: HOST,
    });
    const entries = await previewCells(d.deps, 'node', [HOST], { kind: 'node', nodeId: 'n2' });
    expect(entries).toEqual([expect.objectContaining({ hostLabel: 'Здание 1', from: 1, to: 2 })]);

    const suppressed = deps({
      placeFormulas: [{ definitionId: FIELD, ast: AST }],
      cells: [],
    });
    suppressed.context.record.mockResolvedValue({
      placeId: PLACE,
      values: { [FIELD]: 9 },
      system: {},
      id: HOST,
    });
    const quiet = await previewCells(suppressed.deps, 'node', [HOST], {
      kind: 'node',
      nodeId: 'n2',
    });
    expect(quiet).toEqual([]);
  });

  it('хост не читается или формул нет — тихо пусто; подпись падает на id', async () => {
    const vanished = deps({ record: null });
    expect(
      await previewCells(vanished.deps, 'task', [HOST], { kind: 'node', nodeId: 'n' }),
    ).toEqual([]);

    const noFormulas = deps({ record: { placeId: null, values: {}, system: {}, id: HOST } });
    expect(
      await previewCells(noFormulas.deps, 'task', [HOST], { kind: 'node', nodeId: 'n' }),
    ).toEqual([]);

    const bare = deps({ cells: [{ hostId: HOST, fieldId: FIELD, ast: AST }] });
    bare.context.record.mockResolvedValue({ placeId: null, values: {}, system: {}, id: HOST });
    bare.engine.evaluate.mockReturnValue({ value: 2, error: null });
    const entries = await previewCells(bare.deps, 'task', [HOST], { kind: 'node', nodeId: 'n' });
    expect(entries[0]?.hostLabel).toBe(HOST.slice(0, 8));
  });
});
