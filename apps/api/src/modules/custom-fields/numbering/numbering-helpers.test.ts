import { describe, expect, it, vi } from 'vitest';
import type { NumberContainerHit, NumberSeriesRule } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { NumberHostRecord } from '../ports/number-host.port.js';
import {
  momentNow,
  nameOfSegment,
  participantsOf,
  placeOf,
  readerOf,
  render,
  sampleOf,
} from './numbering-api.helpers.js';
import { NumberHostRegistry } from './number-host.registry.js';

const TX = {} as TransactionClient;
const ACTOR = { id: 'actor', permissions: [] };
const FIELD = '11111111-1111-4111-8111-111111111111';

const host = (overrides: Record<string, unknown> = {}): NumberHostRecord =>
  ({
    kind: 'task',
    id: 'task-1',
    name: 'Задача',
    typeId: 'type-1',
    order: 1,
    visible: true,
    target: {
      host: 'task',
      typeId: 'type-1',
      folders: [{ id: 'folder-1', kindId: 'kind-1' }],
      projectId: 'project-1',
      portfolioId: 'portfolio-1',
      projectTypeId: 'project-type-1',
      parentTaskId: 'parent-1',
      sources: {
        self: { [FIELD]: 'А-101' },
        project: { [FIELD]: 'П-1' },
        parentTask: { [FIELD]: 'Р-1' },
        folders: [{ kindId: 'kind-1', values: { [FIELD]: 'К-1' } }],
      },
    },
    ...overrides,
  }) as never;

const definition = (overrides: Record<string, unknown> = {}) =>
  ({
    id: FIELD,
    number: 7,
    type: 'text',
    name: 'Инв. №',
    bindings: [
      { targetKind: 'process_type', targetId: 'type-1' },
      { targetKind: 'project_type', targetId: 'project-type-1' },
      { targetKind: 'node_kind', targetId: 'kind-1' },
    ],
    ...overrides,
  }) as never;

describe('помощники API счетов (#630)', () => {
  it('participantsOf, placeOf и fieldValue', () => {
    expect(participantsOf(definition())).toEqual(['type-1', 'project-type-1', 'kind-1']);
    const place = placeOf(host(), [definition()]);
    expect(place).toMatchObject({
      host: 'task',
      typeId: 'type-1',
      projectId: 'project-1',
      portfolioId: 'portfolio-1',
      projectTypeId: 'project-type-1',
      parentTaskId: 'parent-1',
    });
    expect(place.fieldValue(7)).toBe('А-101');
    expect(place.fieldValue(8)).toBeNull();
  });

  it('readerOf: все источники и компания', () => {
    const reader = readerOf(host(), [definition()], new Map([[7, 'К-9']]));
    expect(reader({ kind: 'field', fieldNumber: 7, source: 'self' })).toBe('А-101');
    expect(reader({ kind: 'field', fieldNumber: 7, source: 'project' })).toBe('П-1');
    expect(reader({ kind: 'field', fieldNumber: 7, source: 'parent_task' })).toBe('Р-1');
    expect(reader({ kind: 'field', fieldNumber: 7, source: 'folder', nodeKindId: 'kind-1' })).toBe(
      'К-1',
    );
    expect(reader({ kind: 'field', fieldNumber: 7, source: 'company' })).toBe('К-9');
    expect(reader({ kind: 'field', fieldNumber: 9, source: 'self' })).toBe('');
  });

  it('nameOfSegment, render, momentNow, sampleOf', () => {
    expect(nameOfSegment({ kind: 'field', fieldNumber: 7, source: 'self' }, [definition()])).toBe(
      'Инв. №',
    );
    expect(nameOfSegment({ kind: 'field', fieldNumber: 9, source: 'self' }, [])).toBe('—');
    const rule: NumberSeriesRule = {
      containers: [],
      period: 'none',
      template: [{ kind: 'counter' }, { kind: 'literal', text: '-' }, { kind: 'year', digits: 2 }],
      startValue: 1,
      step: 1,
    };
    expect(render(rule, 5)).toMatch(/^5-\d{2}$/);
    expect(momentNow().year).toBeGreaterThan(2000);
    expect(sampleOf(host(), 'no_folder')).toMatchObject({
      kind: 'task',
      id: 'task-1',
      name: 'Задача',
      reason: 'no_folder',
    });
  });
});

describe('NumberHostRegistry (#630): DiscoveryService', () => {
  class TaskProvider {
    static readonly numberHostKinds = ['task'];
    readonly numberHostKinds = TaskProvider.numberHostKinds;
    listHosts = vi.fn(async () => [host()]);
    findHost = vi.fn(async () => host());
    writeNumber = vi.fn(async () => undefined);
    resolveRef = vi.fn(async () => null);
    countWithoutNumber = vi.fn(async () => 2);
  }
  class NodeProvider {
    static readonly numberHostKinds = ['node'];
    readonly numberHostKinds = NodeProvider.numberHostKinds;
    listHosts = vi.fn(async () => [host({ kind: 'node', id: 'node-1' })]);
    findHost = vi.fn(async () => null);
    writeNumber = vi.fn(async () => undefined);
    resolveRef = vi.fn(async () => ({
      entity: 'node' as const,
      id: 'node-1',
      name: 'КЖ-01',
      path: [],
      hidden: false,
      deleted: false,
    }));
    countWithoutNumber = vi.fn(async () => 3);
  }

  it('bootstrap складывает виды, list/find/writeNumber/resolveRef/count', async () => {
    const task = new TaskProvider();
    const node = new NodeProvider();
    const discovery = { getProviders: () => [{ instance: task }, { instance: node }] };
    const registry = new NumberHostRegistry(discovery as never);
    registry.onApplicationBootstrap();
    await expect(registry.list(TX, ACTOR, ['type-1'])).resolves.toHaveLength(2);
    await expect(registry.find(TX, ACTOR, 'task', 'task-1')).resolves.toMatchObject({
      kind: 'task',
    });
    await expect(registry.find(TX, ACTOR, 'letter', 'x')).resolves.toBeNull();
    await registry.writeNumber(TX, 'task', 'task-1', FIELD, '1');
    expect(task.writeNumber).toHaveBeenCalled();
    const hit: NumberContainerHit = { entity: 'node', id: 'node-1' };
    await expect(registry.resolveRef(TX, hit, ACTOR)).resolves.toMatchObject({ name: 'КЖ-01' });
    await expect(registry.countWithoutNumber(TX, ['type-1'], FIELD)).resolves.toBe(5);
  });

  it('дубль вида — ошибка графа; запись без провайдера — ошибка', async () => {
    const first = new TaskProvider();
    const second = new TaskProvider();
    const registry = new NumberHostRegistry({
      getProviders: () => [{ instance: first }, { instance: second }],
    } as never);
    expect(() => registry.onApplicationBootstrap()).toThrow(/already registered/);
    const empty = new NumberHostRegistry({ getProviders: () => [] } as never);
    empty.onApplicationBootstrap();
    await expect(empty.writeNumber(TX, 'task', 'x', FIELD, '1')).rejects.toThrow(/No number host/);
  });
});
