import { describe, expect, it, vi } from 'vitest';
import { PROJECT_EVENTS, WORKFLOW_EVENTS } from '@nodus/contracts';

import { ProjectTypeCreatedScopeHandler } from './project-type-created-scope.handler.js';

/**
 * Свежий тип проекта стартует с пустым списком подключённых типов задач
 * (#857, модель связей): подписчик `project.type_changed` (change=created)
 * исключает новый тип во всех живых типах задач. Копию (sourceTypeId)
 * пропускает — наследование делает `project.type_copied`. Письма не
 * трогаются: их поток системный (ADR-0027).
 */

const NEW_PT = '22222222-2222-4222-8222-222222222222';
const SOURCE_PT = '33333333-3333-4333-8333-333333333333';

const event = (payload: unknown) =>
  ({
    id: 'event-1',
    type: PROJECT_EVENTS.TYPE_CHANGED,
    actorId: 'user-1',
    payload,
    createdAt: '2026-11-27T00:00:00.000Z',
  }) as never;

function makeHandler(rows: { id: string; category?: string; config?: unknown }[]) {
  const types = {
    // Подпись без имён параметров: реализации аргументы не нужны, а вызовы
    // должны быть типизированы (читаем mock.calls).
    list: vi.fn<(archived: string, category?: string) => Promise<typeof rows>>(async () => rows),
    updateConfig: vi.fn<
      (
        tx: unknown,
        id: string,
        config: unknown,
        opts?: { markCustomized?: boolean },
      ) => Promise<void>
    >(async () => undefined),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = {
    emit: vi.fn<(tx: unknown, type: string, payload: unknown, meta?: unknown) => Promise<void>>(
      async () => undefined,
    ),
  };
  const handler = new ProjectTypeCreatedScopeHandler(
    txRunner as never,
    types as never,
    eventBus as never,
  );
  return { handler, types, eventBus };
}

describe('ProjectTypeCreatedScopeHandler — свежий тип проекта без подключений (#857)', () => {
  it('change=created без sourceTypeId: все живые задачи исключают новый тип', async () => {
    const { handler, types, eventBus } = makeHandler([
      {
        id: 't1',
        config: {
          creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
        },
      },
      {
        id: 't2',
        config: {
          creation: {
            excludedProjectTypeIds: ['11111111-1111-4111-8111-111111111111'],
            folderKindId: null,
            withoutProject: false,
          },
        },
      },
    ]);
    await handler.handle(event({ typeId: NEW_PT, change: 'created', fields: ['name'] }));
    expect(types.list).toHaveBeenCalledWith('exclude', 'task');
    expect(types.updateConfig).toHaveBeenCalledTimes(2);
    // Первая запись: исключения пополнились новым типом, старое сохранилось.
    const first = types.updateConfig.mock.calls[0]![2] as {
      creation: { excludedProjectTypeIds: string[] };
    };
    expect(first.creation.excludedProjectTypeIds).toEqual([NEW_PT]);
    const second = types.updateConfig.mock.calls[1]![2] as {
      creation: { excludedProjectTypeIds: string[] };
    };
    expect(second.creation.excludedProjectTypeIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
      NEW_PT,
    ]);
    // Каждому типу — событие изменения (клиенты перечитывают связи).
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
    expect(eventBus.emit.mock.calls[0]![1]).toBe(WORKFLOW_EVENTS.TYPE_UPDATED);
  });

  it('копию пропускает: наследование делает project.type_copied', async () => {
    const { handler, types } = makeHandler([{ id: 't1' }]);
    await handler.handle(
      event({ typeId: NEW_PT, change: 'created', fields: ['name'], sourceTypeId: SOURCE_PT }),
    );
    expect(types.list).not.toHaveBeenCalled();
    expect(types.updateConfig).not.toHaveBeenCalled();
  });

  it('чужие change и битый payload молчат', async () => {
    const { handler, types } = makeHandler([{ id: 't1' }]);
    await handler.handle(event({ typeId: NEW_PT, change: 'updated', fields: ['name'] }));
    await handler.handle(event({ typeId: NEW_PT }));
    await handler.handle(event('мусор'));
    expect(types.list).not.toHaveBeenCalled();
  });

  it('идемпотентен: повторная доставка пропускает уже исключившие', async () => {
    const { handler, types } = makeHandler([
      {
        id: 't1',
        config: {
          creation: { excludedProjectTypeIds: [NEW_PT], folderKindId: null, withoutProject: true },
        },
      },
    ]);
    await handler.handle(event({ typeId: NEW_PT, change: 'created', fields: ['name'] }));
    expect(types.updateConfig).not.toHaveBeenCalled();
  });
});
