import { describe, expect, it, vi } from 'vitest';
import { PROJECT_EVENTS } from '@nodus/contracts';

import { ProjectFieldValuesCleanupHandler } from './project-field-values-cleanup.handler.js';

/**
 * Уборка значений удалённого атрибута (#556, Р11): области `node` и
 * `project`, идемпотентность (повторная доставка — те же запросы, ноль
 * изменений), событие `project.node_kind_changed` на каждый переписанный вид.
 */

const FIELD = '35560000-0000-4000-8000-000000000001';

function makeHandler() {
  const projects = { removeCustomFieldValues: vi.fn(async () => 2) };
  const nodes = { removeCustomFieldValues: vi.fn(async () => 3) };
  const kinds = {
    lockForms: vi.fn(async () => undefined),
    removeFieldFromForms: vi.fn(async () => [{ id: 'kind-1', name: 'Комплект' }]),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handler = new ProjectFieldValuesCleanupHandler(
    txRunner as never,
    eventBus as never,
    projects as never,
    nodes as never,
    kinds as never,
    logger as never,
  );
  return { handler, projects, nodes, kinds, eventBus };
}

function event(payload: Record<string, unknown>) {
  return {
    id: 'evt-1',
    type: 'custom_field.definition_changed',
    actorId: 'admin-1',
    payload,
    createdAt: '2026-11-03T00:00:00.000Z',
  };
}

describe('ProjectFieldValuesCleanupHandler (#556, Р11; #631 — без областей)', () => {
  it('значения папок и формы видов, событие на каждый вид + проекты тем же событием', async () => {
    const { handler, nodes, kinds, eventBus, projects } = makeHandler();
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(projects.removeCustomFieldValues).toHaveBeenCalledWith({}, FIELD);
    expect(nodes.removeCustomFieldValues).toHaveBeenCalledWith({}, FIELD);
    expect(kinds.lockForms).toHaveBeenCalledWith({});
    expect(kinds.removeFieldFromForms).toHaveBeenCalledWith({}, FIELD);
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      { kindId: 'kind-1', change: 'updated', fields: ['form'] },
      { actorId: 'admin-1', aggregateType: 'node_kind', aggregateId: 'kind-1' },
    );
  });

  it('идемпотентность: повторная доставка — те же вызовы (ключа уже нет)', async () => {
    const { handler, projects, nodes } = makeHandler();
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(projects.removeCustomFieldValues).toHaveBeenCalledTimes(2);
    expect(nodes.removeCustomFieldValues).toHaveBeenCalledTimes(2);
  });

  it('чужие события и области игнорируются', async () => {
    const { handler, projects, nodes } = makeHandler();
    await handler.handle(event({ definitionId: FIELD, change: 'updated' }));
    await handler.handle(event({ definitionId: 'не-uuid', change: 'deleted' }));
    expect(projects.removeCustomFieldValues).not.toHaveBeenCalled();
    expect(nodes.removeCustomFieldValues).not.toHaveBeenCalled();
  });

  it('повторная доставка идемпотентна: те же запросы, событий нет без изменённых видов', async () => {
    const { handler, kinds, eventBus } = makeHandler();
    kinds.removeFieldFromForms.mockResolvedValue([]);
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(kinds.removeFieldFromForms).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
