import { describe, expect, it, vi } from 'vitest';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { LetterNumberHostProvider } from './number-host.provider.js';

const ACTOR = { id: 'actor', permissions: [] };
const LETTER = '11111111-1111-4111-8111-111111111111';
const TYPE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const FIELD = '44444444-4444-4444-8444-444444444444';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: LETTER,
  typeId: TYPE,
  projectId: PROJECT,
  subject: 'Письмо вх.',
  customFields: { [FIELD]: 'Вх-1' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

function setup(opts: { visible?: boolean; row?: unknown } = {}) {
  const tx = {
    letter: {
      findMany: vi.fn(async () => [opts.row ?? row()]),
      findFirst: vi.fn(async () => opts.row ?? row()),
      findUnique: vi.fn(async () => ({ id: LETTER, customFields: { [FIELD]: 'Вх-1' } })),
      update: vi.fn(async () => undefined),
    },
    $queryRaw: vi.fn(async () => [{ count: 4 }]),
  } as unknown as TransactionClient & {
    letter: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  const visibility = {
    visibleLetterIds: vi.fn(async () => (opts.visible === false ? new Set() : new Set([LETTER]))),
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
      nodes: [],
    })),
  };
  const events = { emit: vi.fn(async () => undefined) };
  const service = new LetterNumberHostProvider(
    {} as never,
    visibility as never,
    projects as never,
    events as never,
  );
  return { service, tx, visibility, projects, events };
}

describe('LetterNumberHostProvider (#630): письмо как носитель номера', () => {
  it('listHosts: место из проекта, значения письма и проекта, видимость', async () => {
    const { service, tx } = setup({ visible: false });
    const hosts = await service.listHosts(tx as never, ACTOR, [TYPE]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ kind: 'letter', id: LETTER, visible: false });
    expect(hosts[0]!.target).toMatchObject({
      host: 'letter',
      projectId: PROJECT,
      portfolioId: 'portfolio',
      projectTypeId: 'project-type',
    });
    expect(hosts[0]!.target.sources.self[FIELD]).toBe('Вх-1');
    expect(hosts[0]!.target.sources.project?.[FIELD]).toBe('П-1');
    await expect(service.listHosts(tx as never, ACTOR, [])).resolves.toEqual([]);
  });

  it('findHost: только видимое письмо', async () => {
    const visible = setup();
    await expect(
      visible.service.findHost(visible.tx as never, ACTOR, 'letter', LETTER),
    ).resolves.toMatchObject({
      kind: 'letter',
      visible: true,
    });
    const hidden = setup({ visible: false });
    await expect(
      hidden.service.findHost(hidden.tx as never, ACTOR, 'letter', LETTER),
    ).resolves.toBeNull();
    const missing = setup();
    missing.tx.letter.findFirst.mockResolvedValue(null);
    await expect(
      missing.service.findHost(missing.tx as never, ACTOR, 'letter', LETTER),
    ).resolves.toBeNull();
    await expect(
      visible.service.findHost(visible.tx as never, ACTOR, 'task', LETTER),
    ).resolves.toBeNull();
  });

  it('writeNumber: значение и событие письма; неизвестное — no-op', async () => {
    const { service, tx, events } = setup();
    await service.writeNumber(tx as never, 'letter', LETTER, FIELD, 'Вх-2');
    expect(tx.letter.update).toHaveBeenCalledWith({
      where: { id: LETTER },
      data: { customFields: { [FIELD]: 'Вх-2' } },
    });
    expect(events.emit).toHaveBeenCalled();
    await service.writeNumber(tx as never, 'task', LETTER, FIELD, 'x');
    expect(tx.letter.update).toHaveBeenCalledTimes(1);
    tx.letter.findUnique.mockResolvedValue(null);
    await service.writeNumber(tx as never, 'letter', LETTER, FIELD, 'x');
  });

  it('resolveRef не участвует в условиях; countWithoutNumber считает', async () => {
    const { service, tx } = setup();
    await expect(service.resolveRef()).resolves.toBeNull();
    await expect(service.countWithoutNumber(tx as never, [TYPE], FIELD)).resolves.toBe(4);
    await expect(service.countWithoutNumber(tx as never, [], FIELD)).resolves.toBe(0);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});
