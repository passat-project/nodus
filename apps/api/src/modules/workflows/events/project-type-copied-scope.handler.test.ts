import { describe, expect, it, vi } from 'vitest';
import { PROJECT_EVENTS, WORKFLOW_EVENTS } from '@nodus/contracts';

import { ProjectTypeCopiedScopeHandler } from './project-type-copied-scope.handler.js';

/**
 * Копия типа проекта (#857): новый тип наследует исключения «где создаётся»
 * (#665) — типы записей, исключавшие основу, исключают и копию; правка без
 * customizedAt (каталог не «замирает»), событие `workflow.type_updated`;
 * повторная доставка — no-op без второго события.
 */

const SOURCE = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const TASK_TYPE = '33333333-3333-4333-8333-333333333333';

const event = (payload: unknown) =>
  ({
    id: 'event-1',
    type: PROJECT_EVENTS.TYPE_COPIED,
    actorId: 'user-1',
    payload,
    createdAt: '2026-11-26T00:00:00.000Z',
  }) as never;

function makeHandler(rows: { id: string; config: unknown }[]) {
  const types = {
    listExcludingProjectType: vi.fn(async () => rows),
    updateConfig: vi.fn(async () => undefined),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const handler = new ProjectTypeCopiedScopeHandler(
    txRunner as never,
    types as never,
    eventBus as never,
  );
  return { handler, types, eventBus };
}

const excludingConfig = (excludedProjectTypeIds: string[]) => ({
  card: { hiddenBlocks: [], roleLabels: {} },
  access: { view: null, create: null },
  creation: { excludedProjectTypeIds, folderKindId: null, withoutProject: true },
});

describe('ProjectTypeCopiedScopeHandler (#857)', () => {
  it('тип, исключавший основу, исключает и копию — без customizedAt, с событием', async () => {
    const { handler, types, eventBus } = makeHandler([
      { id: TASK_TYPE, config: excludingConfig([SOURCE]) },
    ]);
    await handler.handle(event({ typeId: COPY, sourceTypeId: SOURCE }));
    expect(types.updateConfig).toHaveBeenCalledWith(
      {},
      TASK_TYPE,
      expect.objectContaining({
        creation: expect.objectContaining({ excludedProjectTypeIds: [SOURCE, COPY] }),
      }),
      { markCustomized: false },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      WORKFLOW_EVENTS.TYPE_UPDATED,
      { typeId: TASK_TYPE, fields: ['config.creation'] },
      { actorId: 'user-1', aggregateType: 'process_type', aggregateId: TASK_TYPE },
    );
  });

  it('не исключавшие основу не тронуты (пустая выборка)', async () => {
    const { handler, types, eventBus } = makeHandler([]);
    await handler.handle(event({ typeId: COPY, sourceTypeId: SOURCE }));
    expect(types.updateConfig).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('повторная доставка — no-op: id уже в исключениях, второго события нет', async () => {
    const { handler, types, eventBus } = makeHandler([
      { id: TASK_TYPE, config: excludingConfig([SOURCE, COPY]) },
    ]);
    await handler.handle(event({ typeId: COPY, sourceTypeId: SOURCE }));
    expect(types.updateConfig).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('битый payload игнорируется', async () => {
    const { handler, types } = makeHandler([]);
    await handler.handle(event({ id: COPY }));
    expect(types.listExcludingProjectType).not.toHaveBeenCalled();
  });
});
