import { describe, expect, it, vi } from 'vitest';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { ProjectNumberHostProvider } from './number-host.provider.js';

const TX = {} as TransactionClient;
const ACTOR = { id: 'actor', permissions: [] };
const PROJECT = '11111111-1111-4111-8111-111111111111';
const NODE = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';
const TYPE = '44444444-4444-4444-8444-444444444444';
const KIND = '55555555-5555-4555-8555-555555555555';
const PORTFOLIO = '66666666-6666-4666-8666-666666666666';

const project = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT,
  name: 'Дом',
  typeId: TYPE,
  portfolioId: PORTFOLIO,
  values: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});
const node = (overrides: Record<string, unknown> = {}) => ({
  id: NODE,
  name: 'КЖ-01',
  kindId: KIND,
  projectId: PROJECT,
  parentId: PARENT,
  values: {},
  createdAt: new Date('2026-01-02T00:00:00Z'),
  ...overrides,
});

function setup(opts: { visible?: string[]; projects?: unknown[]; nodes?: unknown[] } = {}) {
  const reader = {
    numberHostsOfTypes: vi.fn(async () => ({
      projects: opts.projects ?? [project()],
      nodes: opts.nodes ?? [node()],
    })),
    viewScopeFor: vi.fn(async () => ({ visibleProjectIds: opts.visible ?? [PROJECT] })),
    numberContext: vi.fn(async (projectIds: string[], nodeIds: string[]) => ({
      projects: projectIds.includes(PROJECT) || nodeIds.includes(NODE) ? [project()] : [],
      nodes: [...nodeIds, ...(projectIds.includes(PROJECT) ? [NODE] : [])].includes(NODE)
        ? [node()]
        : [],
    })),
  };
  const projects = {
    findById: vi.fn(async () => ({
      id: PROJECT,
      name: 'Дом',
      typeId: TYPE,
      portfolioId: PORTFOLIO,
      customFields: {},
    })),
    update: vi.fn(async () => undefined),
  };
  const nodes = {
    findById: vi.fn(async () => ({ id: NODE, projectId: PROJECT, customFields: {} })),
    update: vi.fn(async () => undefined),
  };
  const groups = {
    list: vi.fn(async () => [{ id: PORTFOLIO, name: 'Портфель' }]),
  };
  const types = {
    findById: vi.fn(async () => ({ id: TYPE, name: 'Жилой' })),
  };
  const events = { emit: vi.fn(async () => undefined) };
  const service = new ProjectNumberHostProvider(
    {} as never,
    projects as never,
    nodes as never,
    groups as never,
    types as never,
    reader as never,
    events as never,
  );
  return { service, reader, projects, nodes, groups, types, events };
}

describe('ProjectNumberHostProvider (#630): проекты и папки', () => {
  it('listHosts: проект и папка с цепочкой предков, видимость по проекту', async () => {
    const { service } = setup({
      visible: [],
      nodes: [
        node(),
        node({
          id: PARENT,
          name: 'Здание',
          parentId: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
      ],
    });
    const hosts = await service.listHosts(TX, ACTOR, [TYPE, KIND]);
    expect(hosts).toHaveLength(3);
    const projectHost = hosts.find((entry) => entry.kind === 'project')!;
    const nodeHost = hosts.find((entry) => entry.kind === 'node' && entry.id === NODE)!;
    expect(projectHost.visible).toBe(false);
    expect(projectHost.target.portfolioId).toBe(PORTFOLIO);
    expect(nodeHost.target.folders?.length).toBeGreaterThan(0);
    expect(nodeHost.visible).toBe(false);
  });

  it('findHost: видимый проект/папка и скрытые', async () => {
    const visible = setup();
    await expect(visible.service.findHost(TX, ACTOR, 'project', PROJECT)).resolves.toMatchObject({
      kind: 'project',
      id: PROJECT,
      visible: true,
    });
    await expect(visible.service.findHost(TX, ACTOR, 'node', NODE)).resolves.toMatchObject({
      kind: 'node',
      id: NODE,
      visible: true,
    });
    const hidden = setup({ visible: [] });
    await expect(hidden.service.findHost(TX, ACTOR, 'project', PROJECT)).resolves.toBeNull();
    await expect(hidden.service.findHost(TX, ACTOR, 'node', NODE)).resolves.toBeNull();
    await expect(visible.service.findHost(TX, ACTOR, 'task', NODE)).resolves.toBeNull();
  });

  it('writeNumber: папка и проект пишут значение и событие', async () => {
    const { service, nodes, projects, events } = setup();
    await service.writeNumber(TX, 'node', NODE, 'f-1', 'К-01');
    expect(nodes.update).toHaveBeenCalledWith(TX, NODE, {
      customFields: { 'f-1': 'К-01' },
    });
    expect(events.emit).toHaveBeenCalled();
    await service.writeNumber(TX, 'project', PROJECT, 'f-1', 'П-01');
    expect(projects.update).toHaveBeenCalledWith(TX, PROJECT, {
      customFields: { 'f-1': 'П-01' },
    });
    await service.writeNumber(TX, 'task', PROJECT, 'f-1', 'x');
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it('resolveRef: папка, проект, портфель, тип проекта и неизвестное', async () => {
    const { service } = setup();
    await expect(
      service.resolveRef(TX, { entity: 'node', id: NODE }, ACTOR),
    ).resolves.toMatchObject({ name: 'КЖ-01', path: ['Дом'] });
    await expect(
      service.resolveRef(TX, { entity: 'project', id: PROJECT }, ACTOR),
    ).resolves.toMatchObject({ name: 'Дом' });
    await expect(
      service.resolveRef(TX, { entity: 'portfolio', id: PORTFOLIO }, ACTOR),
    ).resolves.toMatchObject({ name: 'Портфель' });
    await expect(
      service.resolveRef(TX, { entity: 'project_type', id: TYPE }, ACTOR),
    ).resolves.toMatchObject({ name: 'Жилой' });
    await expect(service.resolveRef(TX, { entity: 'node', id: 'gone' }, ACTOR)).resolves.toBeNull();
  });

  it('countWithoutNumber: считает записи без значения поля', async () => {
    const tx = { $queryRaw: vi.fn(async () => [{ count: 3 }]) } as never;
    const { service } = setup();
    await expect(service.countWithoutNumber(tx, [TYPE, KIND], 'f-1')).resolves.toBe(6);
    await expect(service.countWithoutNumber(tx, [], 'f-1')).resolves.toBe(0);
  });
});
