import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FormulaApiService, formulaErrorCodeOf } from './formula-api.service.js';

/** Вычислительно-справочный контур формул (#632, Р10): validate и evaluate
 *  без записи — матрица источников и лимиты действуют и в превью, невидимый
 *  хост — 404 без оракула, префилл создания проверяет доступ актора (Р7). */

const FIELD = '35560000-0000-4000-8000-000000000001';
const HOST = '21000000-0000-4000-8000-000000000002';
const NODE = '21000000-0000-4000-8000-000000000003';
const PARENT = '21000000-0000-4000-8000-000000000004';
const PROJECT = '21000000-0000-4000-8000-000000000005';
const ACTOR = { id: 'user-1', permissions: [] };
const AST = { kind: 'literal', value: 1 } as const;

interface Stubs {
  service: FormulaApiService;
  meta: { snapshot: ReturnType<typeof vi.fn> };
  context: { record: ReturnType<typeof vi.fn>; build: ReturnType<typeof vi.fn> };
  values: { materialize: ReturnType<typeof vi.fn> };
  engine: { validate: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> };
}

function stubs(
  over: {
    definition?: { type: string; settings?: unknown } | null;
    shapeIssues?: { code: string; blocking: boolean; path: string; message: string }[];
    build?: unknown;
    overflowed?: boolean;
    evalValue?: unknown;
    evalError?: unknown;
    materialized?: unknown;
    node?: { projectId: string } | null;
    parent?: { projectId: string; nodeId: string } | null;
    project?: unknown;
  } = {},
): Stubs {
  const byId = new Map(
    over.definition === null || over.definition === undefined
      ? []
      : ([[FIELD, over.definition]] as const),
  );
  const meta = {
    snapshot: vi.fn(async () => ({
      meta: { byNumber: new Map() },
      byNumber: new Map(),
      byId,
      bindingFormulas: new Map(),
    })),
  };
  const context = {
    record: vi.fn(async (kind: string, id: string) => {
      if (kind === 'node') return over.node === undefined ? { projectId: PROJECT } : over.node;
      if (kind === 'task') return over.parent === undefined ? null : over.parent;
      if (kind === 'project') return over.project === undefined ? { id } : over.project;
      return null;
    }),
    build: vi.fn(async () =>
      over.build === undefined
        ? { resolver: {}, overflowed: Boolean(over.overflowed) }
        : over.build,
    ),
  };
  const values = { materialize: vi.fn(async () => over.materialized ?? null) };
  const engine = {
    validate: vi.fn(() => ({
      ok: !(over.shapeIssues ?? []).some((issue) => issue.blocking),
      type: 'number',
      issues: over.shapeIssues ?? [],
    })),
    evaluate: vi.fn(() => ({ value: over.evalValue ?? 1, error: over.evalError ?? null })),
  };
  const service = new FormulaApiService(
    meta as never,
    context as never,
    values as never,
    engine as never,
  );
  return { service, meta, context, values, engine };
}

const validateBody = {
  ast: AST,
  hostKind: 'task' as const,
  targetFieldId: FIELD,
};

describe('FormulaApiService.validate (#632, Р10)', () => {
  it('неизвестный целевой атрибут — 404', async () => {
    const { service } = stubs({ definition: null });
    const failure = await service.validate(validateBody).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainException);
    expect((failure as DomainException).code).toBe(ErrorCode.NOT_FOUND);
  });

  it('тип атрибута из определения; проблемы движка едут контрактом', async () => {
    const { service, engine } = stubs({
      definition: { type: 'number' },
      shapeIssues: [
        { code: 'type_mismatch', blocking: true, path: '', message: 'нет' },
        { code: 'attribute_deleted', blocking: false, path: '', message: 'удалён' },
      ],
    });
    const result = await service.validate(validateBody);
    expect(engine.validate).toHaveBeenCalledWith(
      AST,
      expect.objectContaining({ targetFieldType: 'number', hostKind: 'task' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({ code: 'type_mismatch', blocking: true });
  });

  it('прямой targetType и флаг формулы типа доходят до движка', async () => {
    const { service, engine } = stubs();
    await service.validate({
      ast: AST,
      hostKind: 'node',
      targetType: 'text',
      typeDefault: true,
    });
    expect(engine.validate).toHaveBeenCalledWith(
      AST,
      expect.objectContaining({ targetFieldType: 'text', typeDefault: true }),
    );
  });
});

describe('FormulaApiService.evaluate (#632, Р7/Р12)', () => {
  const hostBody = {
    ast: AST,
    context: { hostKind: 'task', hostId: HOST },
    targetFieldId: FIELD,
  };

  it('блокирующая проблема формы — FORMULA_* с деталями', async () => {
    const { service } = stubs({
      definition: { type: 'number' },
      shapeIssues: [{ code: 'selector_forbidden', blocking: true, path: '', message: 'нельзя' }],
    });
    const failure = await service
      .evaluate(hostBody, ACTOR as never)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainException);
    expect((failure as DomainException).code).toBe(ErrorCode.FORMULA_SOURCE_FORBIDDEN);
  });

  it('невидимый хост — 404; переполнение выборки — selection_limit', async () => {
    const invisible = stubs({ definition: { type: 'number' }, build: null });
    const missing = await invisible.service
      .evaluate(hostBody, ACTOR as never)
      .catch((error: unknown) => error);
    expect((missing as DomainException).code).toBe(ErrorCode.NOT_FOUND);
    const overflow = stubs({ definition: { type: 'number' }, overflowed: true });
    const response = await overflow.service.evaluate(hostBody, ACTOR as never);
    expect(response.error?.code).toBe('selection_limit');
  });

  it('ошибка вычисления — как есть; без типа цели — сырое значение префилла', async () => {
    const errored = stubs({
      definition: { type: 'number' },
      evalError: { code: 'cycle', message: 'цикл' },
    });
    const failure = await errored.service.evaluate(hostBody, ACTOR as never);
    expect(failure.error?.code).toBe('cycle');
    const raw = stubs({ definition: null });
    const response = await raw.service.evaluate(
      { ast: AST, context: { hostKind: 'task', hostId: HOST } },
      ACTOR as never,
    );
    expect(response).toEqual({ value: 1, error: null });
  });

  it('несовпадение типа — type_mismatch; материализация — значение', async () => {
    const mismatch = stubs({
      definition: { type: 'number' },
      evalValue: 'текст',
      materialized: null,
    });
    const response = await mismatch.service.evaluate(hostBody, ACTOR as never);
    expect(response.error?.code).toBe('type_mismatch');
    const ok = stubs({ definition: { type: 'number' }, materialized: 7 });
    const fine = await ok.service.evaluate(hostBody, ACTOR as never);
    expect(fine).toEqual({ value: 7, error: null });
  });

  it('префилл создания: узел без актора, проект узла и родитель сверены (Р7)', async () => {
    const creation = {
      ast: AST,
      context: { creation: { hostKind: 'task', nodeId: NODE, parentId: PARENT } },
    };
    const mismatch = stubs({
      node: { projectId: 'another-project' },
      parent: { projectId: PROJECT, nodeId: NODE },
      project: { id: PROJECT },
    });
    const failure = await mismatch.service
      .evaluate(creation, ACTOR as never)
      .catch((error: unknown) => error);
    expect((failure as DomainException).code).toBe(ErrorCode.NOT_FOUND);

    const ok = stubs({
      node: { projectId: PROJECT },
      parent: { projectId: PROJECT, nodeId: NODE },
      project: { id: PROJECT },
      definition: { type: 'number' },
      materialized: 1,
    });
    const response = await ok.service.evaluate(creation, ACTOR as never);
    expect(response).toEqual({ value: 1, error: null });
    // Узел читается без актёра (видимость — проектом), родитель и проект — с актёром.
    expect(ok.context.record).toHaveBeenCalledWith(
      'node',
      NODE,
      undefined,
      undefined,
      expect.anything(),
    );
    expect(ok.context.record).toHaveBeenCalledWith(
      'task',
      PARENT,
      ACTOR,
      undefined,
      expect.anything(),
    );
    expect(ok.context.record).toHaveBeenCalledWith(
      'project',
      PROJECT,
      ACTOR,
      undefined,
      expect.anything(),
    );
  });
});

describe('formulaErrorCodeOf: код отказа API', () => {
  it('маппинг классов проблем на FORMULA_*', () => {
    expect(formulaErrorCodeOf('type_mismatch')).toBe(ErrorCode.FORMULA_TYPE_MISMATCH);
    expect(formulaErrorCodeOf('source_forbidden')).toBe(ErrorCode.FORMULA_SOURCE_FORBIDDEN);
    expect(formulaErrorCodeOf('selector_forbidden')).toBe(ErrorCode.FORMULA_SOURCE_FORBIDDEN);
    expect(formulaErrorCodeOf('depth')).toBe(ErrorCode.FORMULA_LIMIT_EXCEEDED);
    expect(formulaErrorCodeOf('literal_text')).toBe(ErrorCode.FORMULA_LIMIT_EXCEEDED);
    expect(formulaErrorCodeOf('что-то-другое')).toBe(ErrorCode.FORMULA_AST_INVALID);
  });
});
