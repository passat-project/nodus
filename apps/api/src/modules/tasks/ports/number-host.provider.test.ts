import { describe, expect, it, vi } from 'vitest';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { TaskNumberHostProvider } from './number-host.provider.js';

const TX = {} as TransactionClient;
const ACTOR = { id: 'actor', permissions: [] };
const TASK = '11111111-1111-4111-8111-111111111111';
const TYPE = '22222222-2222-4222-8222-222222222222';
const NODE = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const PARENT = '55555555-5555-4555-8555-555555555555';
const FIELD = '66666666-6666-4666-8666-666666666666';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: TASK,
  title: 'Задача',
  typeId: TYPE,
  nodeId: NODE,
  projectId: PROJECT,
  parentId: PARENT,
  customFields: { [FIELD]: 'Изм. 1' },
  number: 7,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

function setup(opts: { visible?: boolean; row?: unknown } = {}) {
  const query = {
    listNumberHosts: vi.fn(async () => [opts.row ?? row()]),
    numberHostById: vi.fn(async () => opts.row ?? row()),
    numberHostVisibleIds: vi.fn(async () => (opts.visible === false ? new Set() : new Set([TASK]))),
    customFieldsOf: vi.fn(async () => new Map([[PARENT, { [FIELD]: 'Р-1' }]])),
  };
  const tasks = {
    findWithParticipants: vi.fn(async () => ({
      id: TASK,
      number: 7,
      customFields: { [FIELD]: 'Изм. 1' },
      creatorId: 'creator',
      assigneeId: 'assignee',
      participants: [{ userId: 'actor' }],
    })),
    updateFields: vi.fn(async () => undefined),
  };
  const viewer = {
    resolve: vi.fn(async () => ({
      id: 'actor',
      permissions: [],
      subordinateIds: [],
      visibleProjectIds: [],
      hiddenProjectIds: [],
    })),
  };
  const projects = {
    numberContext: vi.fn(async () => ({
      projects: [
        {
          id: PROJECT,
          name: 'Дом',
          typeId: 'project-type',
          portfolioId: 'portfolio',
          values: { [FIELD]: 'П-1' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      nodes: [
        {
          id: NODE,
          name: 'КЖ-01',
          kindId: 'kind-1',
          projectId: PROJECT,
          parentId: null,
          values: { [FIELD]: 'К-1' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    })),
  };
  const events = { emit: vi.fn(async () => undefined) };
  const service = new TaskNumberHostProvider(
    query as never,
    tasks as never,
    viewer as never,
    projects as never,
    events as never,
  );
  return { service, query, tasks, viewer, projects, events };
}

describe('TaskNumberHostProvider (#630): задача как носитель номера', () => {
  it('listHosts: место из папки, проекта и родителя, видимость', async () => {
    const { service } = setup({ visible: false });
    const hosts = await service.listHosts(TX, ACTOR, [TYPE]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ kind: 'task', id: TASK, visible: false });
    expect(hosts[0]!.target).toMatchObject({
      folders: [{ id: NODE, kindId: 'kind-1' }],
      projectId: PROJECT,
      portfolioId: 'portfolio',
      parentTaskId: PARENT,
    });
    expect(hosts[0]!.target.sources.self[FIELD]).toBe('Изм. 1');
    expect(hosts[0]!.target.sources.project?.[FIELD]).toBe('П-1');
    expect(hosts[0]!.target.sources.parentTask?.[FIELD]).toBe('Р-1');
  });

  it('findHost: только видимая задача', async () => {
    const visible = setup();
    await expect(visible.service.findHost(TX, ACTOR, 'task', TASK)).resolves.toMatchObject({
      kind: 'task',
      id: TASK,
      visible: true,
    });
    const hidden = setup({ visible: false });
    await expect(hidden.service.findHost(TX, ACTOR, 'task', TASK)).resolves.toBeNull();
    const missing = setup({ row: null });
    missing.query.numberHostById.mockResolvedValue(null as never);
    await expect(missing.service.findHost(TX, ACTOR, 'task', TASK)).resolves.toBeNull();
    await expect(visible.service.findHost(TX, ACTOR, 'node', TASK)).resolves.toBeNull();
  });

  it('writeNumber: значение в customFields и событие задачи', async () => {
    const { service, tasks, events } = setup();
    await service.writeNumber(TX, 'task', TASK, FIELD, 'Изм. 2');
    expect(tasks.updateFields).toHaveBeenCalledWith(TX, TASK, {
      customFields: { [FIELD]: 'Изм. 2' },
    });
    expect(events.emit).toHaveBeenCalled();
    await service.writeNumber(TX, 'node', TASK, FIELD, 'x');
    expect(tasks.updateFields).toHaveBeenCalledTimes(1);
  });

  it('resolveRef: видимая, скрытая и отсутствующая задача', async () => {
    const visible = setup();
    await expect(
      visible.service.resolveRef(TX, { entity: 'task', id: TASK }, ACTOR),
    ).resolves.toMatchObject({ name: 'Задача', hidden: false });
    const hidden = setup({ visible: false });
    await expect(
      hidden.service.resolveRef(TX, { entity: 'task', id: TASK }, ACTOR),
    ).resolves.toMatchObject({ name: 'Скрытая задача', hidden: true });
    const missing = setup();
    missing.query.numberHostById.mockResolvedValue(null as never);
    await expect(
      missing.service.resolveRef(TX, { entity: 'task', id: TASK }, ACTOR),
    ).resolves.toBeNull();
    await expect(
      visible.service.resolveRef(TX, { entity: 'node', id: TASK }, ACTOR),
    ).resolves.toBeNull();
  });

  it('countWithoutNumber: считает задачи типа без значения', async () => {
    const tx = { $queryRaw: vi.fn(async () => [{ count: 4 }]) } as never;
    const { service } = setup();
    await expect(service.countWithoutNumber(tx, [TYPE], FIELD)).resolves.toBe(4);
    await expect(service.countWithoutNumber(tx, [], FIELD)).resolves.toBe(0);
  });
});
