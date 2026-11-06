import { describe, expect, it, vi } from 'vitest';

import { CounterpartyFieldValuesCleanupHandler } from './counterparty-field-values-cleanup.handler.js';

/** #646: удаление атрибута чистит `counterparties.custom_fields` по событию. */

const FIELD = '64600000-0000-4000-8000-000000000001';

function makeHandler() {
  const counterparties = { removeCustomFieldValues: vi.fn(async () => 2) };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handler = new CounterpartyFieldValuesCleanupHandler(
    counterparties as never,
    logger as never,
  );
  return { handler, counterparties, logger };
}

function event(payload: Record<string, unknown>) {
  return {
    id: 'evt-1',
    type: 'custom_field.definition_changed',
    actorId: 'admin-1',
    payload,
    createdAt: '2026-11-06T00:00:00.000Z',
  };
}

describe('CounterpartyFieldValuesCleanupHandler (#646)', () => {
  it('change=deleted — чистит значения контрагентов', async () => {
    const { handler, counterparties, logger } = makeHandler();
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(counterparties.removeCustomFieldValues).toHaveBeenCalledWith(FIELD);
    expect(logger.debug).toHaveBeenCalledWith(
      { fieldId: FIELD, removed: 2 },
      'Значения удалённого атрибута убраны из контрагентов',
    );
  });

  it('изменения и невалидный payload игнорируются', async () => {
    const { handler, counterparties } = makeHandler();

    await handler.handle(event({ definitionId: FIELD, change: 'updated' }));
    await handler.handle(event({ definitionId: 'не-uuid', change: 'deleted' }));
    expect(counterparties.removeCustomFieldValues).not.toHaveBeenCalled();
  });

  it('повторная доставка идемпотентна: репозиторий вызывается снова, удаляет только остатки', async () => {
    const { handler, counterparties } = makeHandler();
    counterparties.removeCustomFieldValues.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(counterparties.removeCustomFieldValues).toHaveBeenCalledTimes(2);
  });
});
