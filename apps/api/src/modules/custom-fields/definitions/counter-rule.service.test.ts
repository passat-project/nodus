import { ErrorCode } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { CounterRuleService } from './counter-rule.service.js';

const TX = {} as TransactionClient;
const TYPE = '11111111-1111-4111-8111-111111111111';
const PROJECT_TYPE = '22222222-2222-4222-8222-222222222222';
const NODE_KIND = '33333333-3333-4333-8333-333333333333';
const SERIES = '44444444-4444-4444-8444-444444444444';

const rule = (overrides: Record<string, unknown> = {}) => ({
  containers: [{ kind: 'folder' as const, nodeKindId: NODE_KIND }],
  period: 'none' as const,
  template: [{ kind: 'counter' as const }],
  startValue: 1,
  step: 1,
  ...overrides,
});

function setup(opts: { category?: 'task' | 'letter'; issued?: number; current?: unknown } = {}) {
  const series = {
    byId: vi.fn(async () => opts.current ?? null),
    issuedCounts: vi.fn(async () => new Map([[SERIES, opts.issued ?? 0]])),
    create: vi.fn(async () => SERIES),
    update: vi.fn(async () => undefined),
    setNext: vi.fn(async () => undefined),
  };
  const definitions = {
    setNumberSeries: vi.fn(async () => undefined),
    setNumberOnCreate: vi.fn(async () => undefined),
  };
  const catalog = {
    typeRefs: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, category: opts.category ?? 'task' })),
    ),
  };
  const service = new CounterRuleService(definitions as never, series as never, catalog as never);
  return { service, series, definitions, catalog };
}

describe('CounterRuleService (#630)', () => {
  it('shape: numbering только счётчику, next — только сквозному', () => {
    const { service } = setup();
    expect(() => service.assertShape('text', { numbering: rule() as never })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
    );
    expect(() => service.assertShape('counter', { numberingNext: 5 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
    );
    expect(() =>
      service.assertShape('counter', {
        numbering: rule() as never,
        numberingNext: 5,
      }),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
    expect(() =>
      service.assertShape('counter', {
        numbering: rule({ containers: [] }) as never,
        numberingNext: 5,
      }),
    ).not.toThrow();
  });

  it('reachable: письмо не лежит в папке, проект — в проекте', async () => {
    const { service } = setup({ category: 'letter' });
    await expect(
      service.assertReachable(rule() as never, {
        processTypeIds: [TYPE],
        projectTypeIds: [],
        nodeKindIds: [],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NUMBER_CONTAINER_UNREACHABLE });
    const project = setup();
    await expect(
      project.service.assertReachable(rule() as never, {
        processTypeIds: [],
        projectTypeIds: [PROJECT_TYPE],
        nodeKindIds: [],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NUMBER_CONTAINER_UNREACHABLE });
    const node = setup();
    await expect(
      node.service.assertReachable(rule() as never, {
        processTypeIds: [],
        projectTypeIds: [],
        nodeKindIds: [NODE_KIND],
      }),
    ).resolves.toBeUndefined();
  });

  it('triggers: onCreate только у привязанных; папка/проект обязаны быть onCreate', async () => {
    const { service } = setup();
    await expect(
      service.assertTriggers(rule() as never, [TYPE], {
        processTypeIds: [],
        projectTypeIds: [],
        nodeKindIds: [],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NUMBER_TRIGGER_INVALID });
    await expect(
      service.assertTriggers(rule() as never, [NODE_KIND], {
        processTypeIds: [],
        projectTypeIds: [],
        nodeKindIds: [NODE_KIND],
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertTriggers(rule() as never, [], {
        processTypeIds: [],
        projectTypeIds: [],
        nodeKindIds: [NODE_KIND],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NUMBER_TRIGGER_INVALID });
  });

  it('lock: условия и период нельзя менять после первой выдачи', async () => {
    const locked = setup({ issued: 1, current: rule() });
    await expect(
      locked.service.assertNotLocked(TX, SERIES, rule({ period: 'year' }) as never),
    ).rejects.toMatchObject({ code: ErrorCode.NUMBER_RULE_LOCKED });
    await expect(
      locked.service.assertNotLocked(TX, SERIES, rule() as never),
    ).resolves.toBeUndefined();
    const fresh = setup({ issued: 0, current: rule() });
    await expect(
      fresh.service.assertNotLocked(TX, SERIES, rule({ period: 'year' }) as never),
    ).resolves.toBeUndefined();
  });

  it('applyRule: существующая серия — update, новая — create + привязка', async () => {
    const existing = setup();
    await expect(
      existing.service.applyRule(TX, TYPE, SERIES, 'Изм.', rule() as never),
    ).resolves.toBe(SERIES);
    expect(existing.series.update).toHaveBeenCalled();
    const created = setup();
    await expect(created.service.applyRule(TX, TYPE, null, 'Изм.', rule() as never)).resolves.toBe(
      SERIES,
    );
    expect(created.series.create).toHaveBeenCalledWith(TX, {
      code: `counter-${TYPE}`,
      name: 'Изм.',
      rule: rule(),
    });
    expect(created.definitions.setNumberSeries).toHaveBeenCalledWith(TYPE, SERIES, TX);
  });

  it('applyNext/applyOnCreate: продолжение счёта и флаги привязок', async () => {
    const { service, series, definitions } = setup();
    await service.applyNext(TX, SERIES, undefined);
    expect(series.setNext).not.toHaveBeenCalled();
    await service.applyNext(TX, SERIES, 42);
    expect(series.setNext).toHaveBeenCalledWith(TX, SERIES, { hits: [], nextValue: 42 });
    await service.applyOnCreate(TX, TYPE, [TYPE]);
    expect(definitions.setNumberOnCreate).toHaveBeenCalledWith(TYPE, [TYPE], TX);
  });
});
