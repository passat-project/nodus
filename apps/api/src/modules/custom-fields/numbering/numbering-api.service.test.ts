import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type NumberSeriesRule } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import type { NumberHostRecord } from '../ports/number-host.port.js';
import { NumberingApiService } from './numbering-api.service.js';

const TX = {} as TransactionClient;
const FIELD = '11111111-1111-4111-8111-111111111111';
const SERIES = '22222222-2222-4222-8222-222222222222';
const TYPE = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const FOLDER = '55555555-5555-4555-8555-555555555555';
const ACTOR = { id: 'actor', permissions: [] };

const rule: NumberSeriesRule = {
  containers: [{ kind: 'folder', nodeKindId: 'kind-1' }],
  period: 'none',
  template: [{ kind: 'counter' }],
  startValue: 1,
  step: 1,
};

const definition = (overrides: Record<string, unknown> = {}): FieldDefinitionRow =>
  ({
    id: FIELD,
    number: 5,
    type: 'counter',
    name: 'Изм.',
    numberSeriesId: SERIES,
    bindings: [{ targetKind: 'process_type', targetId: TYPE }],
    isCompany: false,
    companyValue: null,
    ...overrides,
  }) as unknown as FieldDefinitionRow;

const host = (overrides: Record<string, unknown> = {}): NumberHostRecord =>
  ({
    kind: 'task',
    id: TASK,
    name: 'Задача',
    typeId: TYPE,
    order: 1,
    visible: true,
    target: {
      host: 'task',
      typeId: TYPE,
      folders: [{ id: FOLDER, kindId: 'kind-1' }],
      projectId: null,
      portfolioId: null,
      projectTypeId: null,
      parentTaskId: null,
      sources: { self: {} },
    },
    ...overrides,
  }) as unknown as NumberHostRecord;

function setup(opts: { host?: unknown; rows?: unknown[]; counter?: unknown } = {}) {
  const definitions = {
    findById: vi.fn(async () => definition()),
    list: vi.fn(async () => [definition()]),
  };
  const series = {
    byId: vi.fn(async () => ({
      id: SERIES,
      name: 'Изм.',
      containers: rule.containers,
      period: rule.period,
      template: rule.template,
      startValue: 1,
      step: 1,
    })),
    counters: vi.fn(
      async () =>
        opts.rows ?? [{ hits: [{ entity: 'node', id: FOLDER }], periodKey: '', lastValue: 2 }],
    ),
    counter: vi.fn(async () => opts.counter ?? { lastValue: 2 }),
    issuedCounts: vi.fn(async () => new Map([[SERIES, 2]])),
    setNext: vi.fn(async () => undefined),
    next: vi.fn(async () => ({ display: '3' })),
  };
  const issue = {
    hostAssignments: vi.fn(async () => [
      {
        fieldId: FIELD,
        display: '2',
        source: 'create',
        sourceLabel: null,
        actorName: null,
        containers: [],
        assignedAt: '2026-11-08T10:00:00.000Z',
      },
    ]),
    plan: vi.fn(async () => ({ ok: true, issue: async () => ({}) })),
  };
  const hosts = {
    list: vi.fn(async () => [opts.host ?? host()]),
    find: vi.fn(async () => opts.host ?? host()),
    resolveRef: vi.fn(async () => ({
      entity: 'node',
      id: FOLDER,
      name: 'КЖ-01',
      path: [],
      hidden: false,
      deleted: false,
    })),
    writeNumber: vi.fn(async () => undefined),
  };
  const refs = {
    refs: vi.fn(async () => [
      { entity: 'node', id: FOLDER, name: 'КЖ-01', path: [], hidden: false, deleted: false },
    ]),
  };
  const service = new NumberingApiService(
    definitions as never,
    series as never,
    issue as never,
    hosts as never,
    refs as never,
  );
  return { service, definitions, series, issue, hosts, refs };
}

describe('NumberingApiService (#630)', () => {
  it('coverage: внутри/снаружи и скрытые не раскрываются', async () => {
    const outside = host({
      visible: false,
      target: { ...host().target, folders: [] },
    });
    const { service } = setup({ host: outside });
    const result = await service.coverage(TX, ACTOR, rule, [TYPE]);
    expect(result.total).toBe(1);
    expect(result.inside).toBe(0);
    expect(result.hiddenOutside).toBe(1);
    expect(result.outside).toEqual([]);
  });

  it('preview: не участник, нет места, успешный номер', async () => {
    const notParticipant = setup({ host: host({ typeId: 'other' }) });
    await expect(
      notParticipant.service.preview(TX, ACTOR, {
        definitionId: FIELD,
        rule,
        participantTypeIds: [TYPE],
        host: { kind: 'task', id: TASK },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'not_participant' });
    const missing = setup({ host: host({ target: { ...host().target, folders: [] } }) });
    await expect(
      missing.service.preview(TX, ACTOR, {
        definitionId: FIELD,
        rule,
        participantTypeIds: [TYPE],
        host: { kind: 'task', id: TASK },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'no_folder' });
    const ok = setup();
    await expect(
      ok.service.preview(TX, ACTOR, {
        definitionId: FIELD,
        rule,
        participantTypeIds: [TYPE],
        host: { kind: 'task', id: TASK },
      }),
    ).resolves.toMatchObject({ ok: true, nextDisplay: '3' });
  });

  it('counts: последний/следующий, фильтр по имени, issued', async () => {
    const { service } = setup();
    const all = await service.counts(TX, FIELD, ACTOR, '');
    expect(all.items[0]).toMatchObject({ lastDisplay: '2', nextDisplay: '3' });
    expect(all.totals).toEqual({ counts: 1, issued: 2 });
    const none = await service.counts(TX, FIELD, ACTOR, 'нет-такого');
    expect(none.items).toEqual([]);
  });

  it('setNext: несовпадение условий и отсутствующий контейнер — 422', async () => {
    const { service } = setup();
    await expect(
      service.setNext(TX, FIELD, ACTOR, { containerIds: [], nextValue: 5 }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    const missing = setup();
    missing.hosts.resolveRef.mockResolvedValue(null as never);
    await expect(
      missing.service.setNext(TX, FIELD, ACTOR, { containerIds: [FOLDER], nextValue: 5 }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('backfill preview: группы, blocked и пустые вставки', async () => {
    const { service } = setup();
    const result = await service.backfillPreview(TX, FIELD, ACTOR);
    expect(result.total).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.emptyParts).toBe(0);
  });

  it('backfill: stale preview и выдача существующим', async () => {
    const runner = { run: vi.fn(async (fn: (tx: TransactionClient) => unknown) => fn(TX)) };
    const { service, series, hosts } = setup();
    await expect(
      service.backfill(runner as never, FIELD, ACTOR, { expectedTotal: 99 }),
    ).rejects.toMatchObject({ code: ErrorCode.NUMBER_BACKFILL_STALE });
    await expect(
      service.backfill(runner as never, FIELD, ACTOR, { expectedTotal: 1 }),
    ).resolves.toEqual({ issued: 1 });
    expect(series.next).toHaveBeenCalled();
    expect(hosts.writeNumber).toHaveBeenCalledWith(TX, 'task', TASK, FIELD, '3');
  });

  it('hostAssignments: журнал записи и 404 невидимой', async () => {
    const { service, issue } = setup();
    await expect(service.hostAssignments(TX, ACTOR, 'task', TASK)).resolves.toMatchObject({
      items: [expect.objectContaining({ fieldId: FIELD })],
    });
    expect(issue.hostAssignments).toHaveBeenCalled();
    const missing = setup({ host: null });
    missing.hosts.find.mockResolvedValue(null as never);
    await expect(missing.service.hostAssignments(TX, ACTOR, 'task', TASK)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
