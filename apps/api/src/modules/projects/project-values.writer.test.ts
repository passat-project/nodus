import { describe, expect, it, vi } from 'vitest';
import { PROJECT_EVENTS } from '@nodus/contracts';

import { ProjectValuesWriter } from './project-values.writer.js';

/** Писатель значений формул проекта/папки (#632, Р4): merge одного ключа
 *  под локом, аудитория node_updated — участники проекта, актёр-триггер
 *  только при прямой правке (security #632: includeActor=false у каскада),
 *  неизменившееся значение — false без события. */

const PROJECT = '21000000-0000-4000-8000-000000000031';
const NODE = '21000000-0000-4000-8000-000000000032';
const FIELD = '35560000-0000-4000-8000-000000000031';
const ACTOR = 'user-actor';
const MEMBER = 'user-member';
const CREATOR = 'user-creator';

function stubs(
  over: {
    changes?: { fieldId: string; from: unknown; to: unknown }[];
    project?: unknown;
    node?: unknown;
  } = {},
) {
  const changes = over.changes ?? [{ fieldId: FIELD, from: null, to: 1 }];
  const projects = {
    lockForUpdate: vi.fn(async () => ({})),
    findById: vi.fn(async () =>
      over.project === undefined
        ? {
            id: PROJECT,
            customFields: {},
            creatorId: CREATOR,
            typeId: 'pt-1',
            managerId: MEMBER,
            assistantIds: [],
          }
        : over.project,
    ),
    update: vi.fn(async () =>
      over.project === undefined
        ? { id: PROJECT, customFields: {}, managerId: MEMBER, assistantIds: [] }
        : over.project,
    ),
  };
  const nodes = {
    lockStructure: vi.fn(async () => undefined),
    lockNode: vi.fn(async () => undefined),
    findInProject: vi.fn(async () =>
      over.node === undefined ? { id: NODE, customFields: {}, kindId: 'nk-1' } : over.node,
    ),
    update: vi.fn(async () => undefined),
  };
  const participants = {
    rowsOfProject: vi.fn(async () => [{ userId: MEMBER }]),
  };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const registry = {
    prepareUpdate: vi.fn(async () => ({ changes, next: { [FIELD]: 1 } })),
  };
  const writer = new ProjectValuesWriter(
    projects as never,
    nodes as never,
    participants as never,
    eventBus as never,
    registry as never,
  );
  return { writer, projects, nodes, participants, eventBus, registry };
}

describe('ProjectValuesWriter: проект (#632, Р4)', () => {
  it('нет проекта или нет изменений — false без записи и события', async () => {
    const locked = stubs();
    locked.projects.lockForUpdate.mockResolvedValue(null);
    expect(await locked.writer.writeProject({} as never, ACTOR, PROJECT, FIELD, 1)).toBe(false);
    expect(locked.eventBus.emit).not.toHaveBeenCalled();

    const silent = stubs({ changes: [] });
    expect(await silent.writer.writeProject({} as never, ACTOR, PROJECT, FIELD, 1)).toBe(false);
    expect(silent.eventBus.emit).not.toHaveBeenCalled();
  });

  it('изменение — аудитория проекта без актёра-триггера, актёр — в метаданных', async () => {
    const d = stubs();
    expect(await d.writer.writeProject({} as never, ACTOR, PROJECT, FIELD, 1)).toBe(true);
    expect(d.eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.UPDATED,
      expect.objectContaining({ audience: [MEMBER], fields: [`cf.${FIELD}`] }),
      expect.objectContaining({ actorId: ACTOR, aggregateId: PROJECT }),
    );
  });
});

describe('ProjectValuesWriter: папка (#632, Р4/security)', () => {
  it('нет узла или нет изменений — false без события', async () => {
    const gone = stubs({ node: null });
    expect(await gone.writer.writeNode({} as never, ACTOR, PROJECT, NODE, FIELD, 1)).toBe(false);
    expect(gone.eventBus.emit).not.toHaveBeenCalled();

    const silent = stubs({ changes: [] });
    expect(await silent.writer.writeNode({} as never, ACTOR, PROJECT, NODE, FIELD, 1)).toBe(false);
    expect(silent.eventBus.emit).not.toHaveBeenCalled();
  });

  it('прямая правка: актёр в аудитории node_updated вместе с участниками', async () => {
    const d = stubs();
    expect(await d.writer.writeNode({} as never, ACTOR, PROJECT, NODE, FIELD, 1)).toBe(true);
    expect(d.eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.NODE_UPDATED,
      expect.objectContaining({
        audience: [MEMBER, ACTOR],
        customFieldChanges: [{ fieldId: FIELD, from: null, to: 1 }],
      }),
      expect.objectContaining({ aggregateId: NODE }),
    );
  });

  it('каскадный пересчёт (includeActor=false) и безактёрный — актёра в аудитории нет', async () => {
    const cascade = stubs();
    await cascade.writer.writeNode({} as never, ACTOR, PROJECT, NODE, FIELD, 1, {
      includeActor: false,
    });
    expect(cascade.eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.NODE_UPDATED,
      expect.objectContaining({ audience: [MEMBER] }),
      expect.anything(),
    );

    const noActor = stubs();
    await noActor.writer.writeNode({} as never, null, PROJECT, NODE, FIELD, 1);
    expect(noActor.eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.NODE_UPDATED,
      expect.objectContaining({ audience: [MEMBER] }),
      expect.anything(),
    );
  });

  it('проект исчез — событие едет без аудитории (gateway простит)', async () => {
    const d = stubs({ project: null });
    await d.writer.writeNode({} as never, ACTOR, PROJECT, NODE, FIELD, 1);
    const payload = d.eventBus.emit.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload.audience).toBeUndefined();
  });
});
