import { describe, expect, it, vi } from 'vitest';
import { FORMULA_LIMITS, type FormulaNode } from '@nodus/contracts';
import type { FormulaEvaluation, FormulaResolver, FormulaValue } from '@nodus/formula-engine';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaCellRef } from '../ports/formula-cells.port.js';
import type { FormulaEngine } from '../ports/formula-engine.port.js';
import { FormulaCellsService } from './formula-cells.service.js';
import type { FormulaCellRow, FormulaCellsRepository } from './formula-cells.repository.js';
import type { FormulaContext, FormulaContextService } from './formula-context.service.js';
import type { FormulaMetaService, FormulaRegistrySnapshot } from './formula-meta.service.js';
import type { FormulaValuesService } from './formula-values.service.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';

/**
 * Сервис ячеек-формул (#632, A10-02): прямой unit-контракт без PostgreSQL.
 *
 * Проверяются ветки, которые через HTTP видны только долгим сценарием: обрыв
 * каскада по глубине (`cycle`, событие молчит), потеря контекста хоста (ячейки
 * хоста умирают), исчезнувшее определение атрибута (ячейка снимается),
 * блокирующая проблема валидации (422) и шум-контроль `changed` (одинаковое
 * значение не двигает каскад).
 */

const HOST_ID = '11111111-1111-4111-8111-111111111111';
const FIELD_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const CELL_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';
const TX = { marker: 'tx' } as unknown as TransactionClient;

const AST: FormulaNode = {
  kind: 'op',
  op: 'mul',
  args: [
    { kind: 'field', source: { kind: 'self' }, number: 7, name: 'Номер' },
    { kind: 'literal', value: 2 },
  ],
};

const REF: FormulaCellRef = {
  cellId: CELL_ID,
  hostKind: 'task',
  hostId: HOST_ID,
  fieldId: FIELD_ID,
};
const SAVE = {
  hostKind: 'task',
  hostId: HOST_ID,
  fieldId: FIELD_ID,
  ast: AST,
  actorId: ACTOR,
} as const;
const SILENT = { value: null, error: null, changed: false, errorChanged: false, silent: true };

function definition(over: Partial<FieldDefinitionRow> & { id: string; number: number }) {
  return {
    type: 'number',
    name: 'Атрибут',
    hint: null,
    settings: {},
    defaultValue: null,
    reportIndexed: false,
    isCompany: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    bindings: [],
    companyValue: null,
    ...over,
  } as FieldDefinitionRow;
}

function snapshot(rows: FieldDefinitionRow[]): FormulaRegistrySnapshot {
  return {
    meta: { byNumber: new Map() },
    byNumber: new Map(rows.map((row) => [row.number, row])),
    byId: new Map(rows.map((row) => [row.id, row])),
    bindingFormulas: new Map(),
  };
}

function cell(over: Partial<FormulaCellRow> = {}): FormulaCellRow {
  return {
    id: CELL_ID,
    hostKind: 'task',
    hostId: HOST_ID,
    fieldId: FIELD_ID,
    ast: AST,
    error: null,
    computedAt: new Date(),
    recalcDepth: 0,
    ...over,
  };
}

/** Хост контекста с заданными значениями атрибутов (что уже лежит в ячейке). */
function context(values: Record<string, unknown> = {}): FormulaContext {
  return {
    resolver: {} as FormulaResolver,
    host: {
      kind: 'task',
      id: HOST_ID,
      values: values as never,
      system: {},
      projectId: null,
      parentId: null,
      nodeId: null,
      placeId: HOST_ID,
      confidential: false,
    },
    depKeys: [{ key: `v:task:${HOST_ID}:7`, attrNumber: 7 }],
    overflowed: false,
    placeFormula: () => null,
  };
}

/** Стенд сервиса: моки репозитория/реестра/контекста/движка и значений. */
function stand(
  options: {
    cell?: FormulaCellRow | null;
    context?: FormulaContext | null;
    rows?: FieldDefinitionRow[];
    value?: FormulaValue;
    issues?: { code: string; blocking: boolean; message?: string }[];
  } = {},
) {
  const rows = options.rows ?? [
    definition({ id: FIELD_ID, number: 8 }),
    definition({ id: SOURCE_ID, number: 7 }),
  ];
  const repo = {
    find: vi.fn(async () => (options.cell === undefined ? cell() : options.cell)),
    updateState: vi.fn(async () => undefined),
    deleteByHost: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    replaceDeps: vi.fn(async () => undefined),
    upsert: vi.fn(async () => CELL_ID),
  };
  const meta = { snapshot: vi.fn(async () => snapshot(rows)) };
  const contextService = {
    build: vi.fn(async () => (options.context === undefined ? context() : options.context)),
  };
  const values = { materialize: vi.fn(async (_def: unknown, value: unknown) => value) };
  const engine = {
    evaluate: vi.fn((): FormulaEvaluation => ({ value: options.value ?? null, error: null })),
    validate: vi.fn(() => ({ ok: true, issues: options.issues ?? [], type: 'number' as const })),
    inferType: vi.fn(),
    extractDeps: vi.fn(() => []),
  };
  const service = new FormulaCellsService(
    repo as unknown as FormulaCellsRepository,
    meta as unknown as FormulaMetaService,
    contextService as unknown as FormulaContextService,
    values as unknown as FormulaValuesService,
    engine as unknown as FormulaEngine,
  );
  return { service, repo, meta, contextService, values, engine };
}

describe('FormulaCellsService.recalc: каскад, контекст и реестр (Р4/Р8/Р13)', () => {
  it('глубина выше лимита — ошибка cycle, событие молчит, errorChanged по коду', async () => {
    // Прежняя ошибка другая — смена причины обязана поднять бейдж (C7).
    const { service, repo, engine } = stand({
      cell: cell({ error: { code: 'division_by_zero', message: 'Деление на ноль' } }),
    });

    const outcome = await service.recalc(TX, REF, FORMULA_LIMITS.cascadeDepth + 1);

    expect(outcome).toMatchObject({
      value: null,
      error: { code: 'cycle' },
      changed: true,
      errorChanged: true,
      silent: true,
    });
    expect(repo.updateState).toHaveBeenCalledWith(TX, CELL_ID, {
      error: { code: 'cycle', message: expect.any(String) },
      depth: FORMULA_LIMITS.cascadeDepth + 1,
    });
    // Живой цикл не вычисляется и не переписывает зависимости — волна стоит.
    expect(engine.evaluate).not.toHaveBeenCalled();
    expect(repo.replaceDeps).not.toHaveBeenCalled();

    // Та же ошибка cycle на следующем шаге — уже не новость: событие молчит.
    const repeated = stand({ cell: cell({ error: { code: 'cycle', message: 'cycle' } }) });
    const second = await repeated.service.recalc(TX, REF, FORMULA_LIMITS.cascadeDepth + 5);
    expect(second.errorChanged).toBe(false);
    expect(second.silent).toBe(true);
  });

  it('на границе лимита пересчёт идёт обычным путём (не cycle)', async () => {
    const { service, repo } = stand({ value: 14 });

    const outcome = await service.recalc(TX, REF, FORMULA_LIMITS.cascadeDepth);

    expect(outcome).toMatchObject({ value: 14, error: null, silent: false });
    expect(repo.updateState).toHaveBeenCalledWith(TX, CELL_ID, {
      error: null,
      depth: FORMULA_LIMITS.cascadeDepth,
    });
  });

  it('потеря контекста хоста — ячейки хоста удаляются, событие молчит', async () => {
    const { service, repo } = stand({ context: null });

    expect(await service.recalc(TX, REF, 1)).toEqual(SILENT);
    expect(repo.deleteByHost).toHaveBeenCalledWith(TX, 'task', HOST_ID);
    expect(repo.remove).not.toHaveBeenCalled();
    expect(repo.updateState).not.toHaveBeenCalled();
  });

  it('определения атрибута больше нет — ячейка снимается, событие молчит', async () => {
    const { service, repo } = stand({ rows: [definition({ id: SOURCE_ID, number: 7 })] });

    expect(await service.recalc(TX, REF, 1)).toEqual(SILENT);
    expect(repo.remove).toHaveBeenCalledWith(TX, 'task', HOST_ID, FIELD_ID);
    expect(repo.updateState).not.toHaveBeenCalled();
  });

  it('ячейку сняли до события — пересчитывать нечего (silent)', async () => {
    const { service, repo, contextService } = stand({ cell: null });

    expect(await service.recalc(TX, REF, 1)).toEqual(SILENT);
    expect(contextService.build).not.toHaveBeenCalled();
    expect(repo.updateState).not.toHaveBeenCalled();
  });
});

describe('FormulaCellsService.recalc: значение и шум каскада (Р4)', () => {
  it('то же значение — changed=false, зависимости всё равно обновляются', async () => {
    const { service, repo, contextService } = stand({
      value: 14,
      context: context({ [FIELD_ID]: 14 }),
    });

    const outcome = await service.recalc(TX, REF, 1);

    expect(outcome).toMatchObject({
      value: 14,
      changed: false,
      errorChanged: false,
      silent: false,
    });
    expect(contextService.build).toHaveBeenCalledWith(
      { hostKind: 'task', hostId: HOST_ID, asts: [AST], snapshot: expect.any(Object) },
      TX,
    );
    expect(repo.replaceDeps).toHaveBeenCalledWith(TX, CELL_ID, context().depKeys);
    expect(repo.updateState).toHaveBeenCalledWith(TX, CELL_ID, { error: null, depth: 1 });
  });

  it('новое значение — changed=true (каскад продолжается)', async () => {
    const { service } = stand({ value: 14, context: context({ [FIELD_ID]: 10 }) });

    const outcome = await service.recalc(TX, REF, 1);

    expect(outcome).toMatchObject({ value: 14, changed: true, silent: false });
  });
});

describe('FormulaCellsService.save: проверка AST и запись (Р13)', () => {
  it('блокирующая проблема валидации — DomainException 422, в БД ничего', async () => {
    const { service, repo, engine } = stand({
      issues: [{ code: 'depth', blocking: true, message: 'formula nesting exceeds 12' }],
    });

    const failure = await service.save(TX, SAVE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DomainException);
    const domain = failure as DomainException;
    expect(domain.httpStatus).toBe(422);
    // Код отказа — из матрицы валидации (`depth` → лимит формулы).
    expect(domain.code).toBe('FORMULA_LIMIT_EXCEEDED');
    expect(domain.details).toMatchObject({ issues: [expect.objectContaining({ code: 'depth' })] });
    expect(engine.evaluate).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('неблокирующая проблема не мешает сохранению', async () => {
    const { service, repo } = stand({
      value: 14,
      issues: [{ code: 'empty_operand', blocking: false, message: 'пустой операнд' }],
    });

    expect(await service.save(TX, SAVE)).toEqual({ value: 14, error: null });
    expect(repo.upsert).toHaveBeenCalledWith(TX, {
      hostKind: 'task',
      hostId: HOST_ID,
      fieldId: FIELD_ID,
      ast: AST,
      createdById: ACTOR,
    });
    expect(repo.replaceDeps).toHaveBeenCalledWith(TX, CELL_ID, context().depKeys);
    expect(repo.updateState).toHaveBeenCalledWith(TX, CELL_ID, { error: null, depth: 0 });
  });

  it('неизвестный атрибут — 404 до валидации и записи', async () => {
    const { service, repo, engine } = stand({ rows: [] });

    const failure = await service.save(TX, SAVE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DomainException);
    expect((failure as DomainException).code).toBe('NOT_FOUND');
    expect(engine.validate).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('ошибка вычисления сохранение не блокирует (Р13): ячейка пишется с error', async () => {
    const { service, repo, engine } = stand();
    const division = { code: 'division_by_zero' as const, message: 'Деление на ноль' };
    engine.evaluate.mockReturnValue({ value: null, error: division });

    expect((await service.save(TX, SAVE)).error).toEqual(division);
    expect(repo.upsert).toHaveBeenCalled();
    expect(repo.updateState).toHaveBeenCalledWith(TX, CELL_ID, { error: division, depth: 0 });
  });
});
