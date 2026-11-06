import { describe, expect, it, vi } from 'vitest';

import { ProcessTypeFormCleanerProvider } from './process-type-form-cleaner.provider.js';

/**
 * Уборка формы создания маршрута при удалении/отвязке атрибута (#646):
 * слот `cf.<id>` живёт в опубликованном документе (`workflows.creation`),
 * и required-слот удалённого атрибута иначе блокирует создание задачи типа
 * навсегда. После изменения — каталожное `workflow.type_updated`.
 */
function make() {
  const eventBus = { emit: vi.fn(async () => undefined) };
  const tx = { $queryRaw: vi.fn() };
  const provider = new ProcessTypeFormCleanerProvider(eventBus as never);
  return { provider, eventBus, tx };
}

describe('ProcessTypeFormCleanerProvider (#646)', () => {
  it('снимает слот и эмитит workflow.type_updated на затронутый тип', async () => {
    const { provider, eventBus, tx } = make();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'w-1' }])
      .mockResolvedValueOnce([{ id: 't-1', name: 'Стандартный' }]);

    const changed = await provider.removeFieldFromCreationForms(
      'c0000000-0000-4000-8000-0000000000aa',
      'actor-1',
      tx as never,
    );

    expect(changed).toEqual([{ typeId: 't-1', name: 'Стандартный' }]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      tx,
      'workflow.type_updated',
      { typeId: 't-1', fields: ['creation'] },
      { actorId: 'actor-1', aggregateType: 'process_type', aggregateId: 't-1' },
    );
  });

  it('идемпотентен: нет слота — нет события и изменений', async () => {
    const { provider, eventBus, tx } = make();
    tx.$queryRaw.mockResolvedValueOnce([]);

    const changed = await provider.removeFieldFromCreationForms('field-1', null, tx as never);

    expect(changed).toEqual([]);
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('событие не эмитится, если у маршрута нет типа процесса', async () => {
    const { provider, eventBus, tx } = make();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'w-1' }]).mockResolvedValueOnce([]);

    const changed = await provider.removeFieldFromCreationForms('field-1', 'actor-1', tx as never);

    expect(changed).toEqual([]);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
