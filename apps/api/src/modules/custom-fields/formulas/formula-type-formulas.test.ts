import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldType, FormulaHostKind, FormulaNode } from '@nodus/contracts';

import { applyTypeFormulas } from './formula-type-formulas.js';
import type { FormulaStateMap } from '../ports/formula-cells.port.js';

/** Формулы типа/вида на чтении (#632, Р6): без своей формулы ячейки —
 *  вычисление поверх DTO без записи в БД. Стабы контекста/движка/
 *  материализации: ветви — подавление своей формулой, ошибка, переполнение
 *  выборки, ЛОЖЬ в bool, несовпадение типа. */

const AST: FormulaNode = { kind: 'literal', value: 1 };
const HOST = '21000000-0000-4000-8000-000000000001';
const FIELD = '35560000-0000-4000-8000-000000000001';
const PLACE = 'place-1';

function stubs(
  opts: {
    evalValue?: unknown;
    evalError?: { code: 'cycle'; message: string } | null;
    overflowed?: boolean;
    buildNull?: boolean;
    recordPlace?: string | null;
    materialized?: unknown;
    definitionType?: CustomFieldType;
  } = {},
) {
  const record = vi.fn(async () => ({
    placeId: opts.recordPlace === undefined ? PLACE : opts.recordPlace,
  }));
  const build = vi.fn(async () =>
    opts.buildNull ? null : { resolver: {}, overflowed: Boolean(opts.overflowed) },
  );
  const evaluate = vi.fn(() => ({
    value: opts.evalValue ?? 1,
    error: opts.evalError ?? null,
  }));
  const materialize = vi.fn(async () => opts.materialized ?? null);
  const snapshot = {
    meta: { byNumber: new Map() },
    byNumber: new Map(),
    byId: new Map([[FIELD, { type: opts.definitionType ?? 'number' }]]),
    bindingFormulas: new Map([[PLACE, [{ definitionId: FIELD, ast: AST }]]]),
  };
  return {
    record,
    build,
    evaluate,
    materialize,
    snapshot,
    context: { record, build },
    engine: { evaluate },
    values: { materialize },
    cache: { key: 1 },
  };
}

function run(
  stub: ReturnType<typeof stubs>,
  args: Partial<Parameters<typeof applyTypeFormulas>[0]> = {},
) {
  const result: FormulaStateMap = new Map();
  return {
    result,
    promise: applyTypeFormulas({
      hostKind: 'task' as FormulaHostKind,
      hostIds: [HOST],
      snapshot: stub.snapshot as never,
      ownByHost: new Map(),
      result,
      cache: stub.cache as never,
      context: stub.context as never,
      engine: stub.engine as never,
      values: stub.values as never,
      ...args,
    }),
  };
}

describe('applyTypeFormulas: формулы типа на чтении (#632, Р6)', () => {
  it('нет формул мест на портале — хосты не читаются вовсе', async () => {
    const stub = stubs();
    stub.snapshot.bindingFormulas = new Map();
    const empty = run(stub);
    await empty.promise;
    expect(stub.record).not.toHaveBeenCalled();
    expect(empty.result.size).toBe(0);
  });

  it('место из листинга без формул — запись хоста не читается (анти-N+1)', async () => {
    const stub = stubs();
    const quiet = run(stub, { places: new Map([[HOST, 'place-without-formulas']]) });
    await quiet.promise;
    expect(stub.record).not.toHaveBeenCalled();
    expect(quiet.result.size).toBe(0);
  });

  it('хост без места и с пустым контекстом — тихо пропускается', async () => {
    const noPlace = run(stubs({ recordPlace: null }));
    await noPlace.promise;
    expect(noPlace.result.size).toBe(0);
    const nullBuild = run(stubs({ buildNull: true }));
    await nullBuild.promise;
    expect(nullBuild.result.size).toBe(0);
  });

  it('успех: значение и origin type в состоянии ячейки', async () => {
    const stub = stubs({ evalValue: 7, materialized: 7 });
    const ok = run(stub);
    await ok.promise;
    const state = ok.result.get(HOST);
    expect(state?.values[FIELD]).toBe(7);
    expect(state?.formulas[FIELD]).toEqual({ origin: 'type' });
  });

  it('своя формула ячейки сильнее — слот типа не вычисляется', async () => {
    const stub = stubs({ evalValue: 7, materialized: 7 });
    const suppressed = run(stub, { ownByHost: new Map([[HOST, [FIELD]]]) });
    await suppressed.promise;
    expect(stub.build).not.toHaveBeenCalled();
    expect(suppressed.result.size).toBe(0);
  });

  it('ошибка вычисления и переполнение выборки — ошибка в формуле, без значения', async () => {
    const errored = run(stubs({ evalError: { code: 'cycle', message: 'цикл' } }));
    await errored.promise;
    expect(errored.result.get(HOST)?.formulas[FIELD]).toEqual({
      origin: 'type',
      error: { code: 'cycle', message: 'цикл' },
    });
    const overflow = run(stubs({ overflowed: true }));
    await overflow.promise;
    expect(overflow.result.get(HOST)?.formulas[FIELD]?.error?.code).toBe('selection_limit');
  });

  it('ЛОЖЬ в bool — пустое значение без ошибки; несовпадение типа — ошибка', async () => {
    const boolFalse = run(stubs({ evalValue: false, definitionType: 'bool', materialized: null }));
    await boolFalse.promise;
    const boolState = boolFalse.result.get(HOST);
    expect(boolState?.values[FIELD]).toBeUndefined();
    expect(boolState?.formulas[FIELD]).toEqual({ origin: 'type' });
    const mismatch = run(
      stubs({ evalValue: 'текст', definitionType: 'number', materialized: null }),
    );
    await mismatch.promise;
    expect(mismatch.result.get(HOST)?.formulas[FIELD]?.error?.code).toBe('type_mismatch');
  });

  it('определения нет в снимке — только пометка формулы, без материализации', async () => {
    const stub = stubs({ evalValue: 1, materialized: 1 });
    stub.snapshot.byId = new Map();
    const noDef = run(stub);
    await noDef.promise;
    const state = noDef.result.get(HOST);
    expect(state?.formulas[FIELD]).toEqual({ origin: 'type' });
    expect(state?.values[FIELD]).toBeUndefined();
    expect(stub.materialize).not.toHaveBeenCalled();
  });
});
