import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FormulaBindingService } from './formula-binding.service.js';

/** Формула места (#632, Р6): AST на привязке, набор целиком атомарно,
 *  формулы только для привязанных мест, валидация с typeDefault (без
 *  связанных записей и цепочки папок), письмо/задача — по категории типа. */

const DEF = '35560000-0000-4000-8000-000000000021';
const T_TASK = '21000000-0000-4000-8000-000000000021';
const T_LETTER = '21000000-0000-4000-8000-000000000022';
const T_NODE = '21000000-0000-4000-8000-000000000023';
const AST = { kind: 'literal', value: 1 } as const;

function stubs(
  over: {
    row?: { id: string; isCompany: boolean; type: string; bindings: unknown[] } | null;
    letterType?: boolean;
    blocking?: { code: string; blocking: boolean; path: string; message: string }[];
  } = {},
) {
  const row =
    over.row === undefined
      ? {
          id: DEF,
          isCompany: false,
          type: 'number',
          bindings: [
            { targetKind: 'process_type', targetId: T_TASK },
            { targetKind: 'node_kind', targetId: T_NODE },
          ],
        }
      : over.row;
  const definitions = {
    findById: vi.fn(async () => row),
    setBindingFormula: vi.fn(async () => ({})),
    lockRegistry: vi.fn(async () => undefined),
  };
  const mapper = { toDto: vi.fn(async () => ({ id: DEF })) };
  const meta = {
    snapshot: vi.fn(async () => ({ meta: { byNumber: new Map() }, byId: new Map() })),
  };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const engine = {
    validate: vi.fn(() => ({
      ok: !(over.blocking ?? []).some((issue) => issue.blocking),
      type: 'number',
      issues: over.blocking ?? [],
    })),
  };
  const catalog = {
    typeById: vi.fn(async () => ({ category: over.letterType ? 'letter' : 'task' })),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({} as never) };
  const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const service = new FormulaBindingService(
    definitions as never,
    mapper as never,
    meta as never,
    txRunner as never,
    eventBus as never,
    engine as never,
    catalog as never,
    logger() as never,
  );
  return { service, definitions, mapper, eventBus, engine, catalog, meta };
}

describe('FormulaBindingService.applyWithinTx: атомарная замена набора (#632, Р6)', () => {
  it('глобальная переменная и отсутствующее определение — отказ', async () => {
    const company = stubs({ row: { id: DEF, isCompany: true, type: 'number', bindings: [] } });
    const failure = await company.service
      .applyWithinTx({} as never, { id: DEF, isCompany: true, type: 'number' }, {}, 'u')
      .catch((error: unknown) => error);
    expect((failure as DomainException).code).toBe(ErrorCode.CUSTOM_FIELD_BINDING_INVALID);

    const missing = stubs({ row: null });
    const notFound = await missing.service
      .applyWithinTx({} as never, { id: DEF, isCompany: false, type: 'number' }, {}, 'u')
      .catch((error: unknown) => error);
    expect((notFound as DomainException).code).toBe(ErrorCode.NOT_FOUND);
  });

  it('формула для места без привязки — отказ с targetIds', async () => {
    const { service } = stubs();
    const failure = await service
      .applyWithinTx(
        {} as never,
        { id: DEF, isCompany: false, type: 'number' },
        { 'unbound-target': AST },
        'u',
      )
      .catch((error: unknown) => error);
    expect((failure as DomainException).code).toBe(ErrorCode.CUSTOM_FIELD_BINDING_INVALID);
  });

  it('сначала все проверки, потом записи: блокирующая проблема — ни одной записи', async () => {
    const d = stubs({
      blocking: [{ code: 'selector_forbidden', blocking: true, path: '', message: 'нельзя' }],
    });
    const failure = await d.service
      .applyWithinTx(
        {} as never,
        { id: DEF, isCompany: false, type: 'number' },
        { [T_TASK]: AST },
        'u',
      )
      .catch((error: unknown) => error);
    expect((failure as DomainException).code).toBe(ErrorCode.FORMULA_SOURCE_FORBIDDEN);
    expect(d.definitions.setBindingFormula).not.toHaveBeenCalled();
  });

  it('успех: каждой привязке — формула или null (полная замена набора)', async () => {
    const d = stubs();
    await d.service.applyWithinTx(
      {} as never,
      { id: DEF, isCompany: false, type: 'number' },
      { [T_NODE]: AST },
      'u',
    );
    expect(d.definitions.setBindingFormula).toHaveBeenCalledTimes(2);
    expect(d.definitions.setBindingFormula).toHaveBeenCalledWith(
      DEF,
      'process_type',
      T_TASK,
      null,
      expect.anything(),
    );
    expect(d.definitions.setBindingFormula).toHaveBeenCalledWith(
      DEF,
      'node_kind',
      T_NODE,
      AST,
      expect.anything(),
    );
  });
});

describe('FormulaBindingService.write: одна привязка (#632, Р6)', () => {
  it('привязка не найдена и определение исчезло — 404', async () => {
    const d = stubs();
    const failure = await d.service
      .setFormula(DEF, 'unknown-target', AST, 'u')
      .catch((error: unknown) => error);
    expect((failure as DomainException).code).toBe(ErrorCode.NOT_FOUND);

    const gone = stubs({ row: null });
    const vanished = await gone.service
      .removeFormula(DEF, T_TASK, 'u')
      .catch((error: unknown) => error);
    expect((vanished as DomainException).code).toBe(ErrorCode.NOT_FOUND);
  });

  it('постановка: лок реестра, запись AST, событие defaultFormula, DTO', async () => {
    const d = stubs();
    const dto = await d.service.setFormula(DEF, T_TASK, AST, 'u');
    expect(dto).toEqual({ id: DEF });
    expect(d.definitions.lockRegistry).toHaveBeenCalled();
    expect(d.definitions.setBindingFormula).toHaveBeenCalledWith(
      DEF,
      'process_type',
      T_TASK,
      AST,
      expect.anything(),
    );
    expect(d.eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('снятие: AST null, валидация не вызывается', async () => {
    const d = stubs();
    await d.service.removeFormula(DEF, T_NODE, 'u');
    expect(d.engine.validate).not.toHaveBeenCalled();
    expect(d.definitions.setBindingFormula).toHaveBeenCalledWith(
      DEF,
      'node_kind',
      T_NODE,
      null,
      expect.anything(),
    );
  });

  it('тип процесса решает носителя: письмо — letter, задача — task', async () => {
    const letter = stubs({
      row: {
        id: DEF,
        isCompany: false,
        type: 'number',
        bindings: [{ targetKind: 'process_type', targetId: T_LETTER }],
      },
      letterType: true,
    });
    await letter.service.setFormula(DEF, T_LETTER, AST, 'u');
    expect(letter.engine.validate).toHaveBeenCalledWith(
      AST,
      expect.objectContaining({ hostKind: 'letter', typeDefault: true }),
    );

    const task = stubs();
    await task.service.setFormula(DEF, T_TASK, AST, 'u');
    expect(task.engine.validate).toHaveBeenCalledWith(
      AST,
      expect.objectContaining({ hostKind: 'task' }),
    );
  });
});
