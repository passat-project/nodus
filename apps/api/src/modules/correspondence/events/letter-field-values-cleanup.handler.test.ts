import { describe, expect, it, vi } from 'vitest';

import { LetterFieldValuesCleanupHandler } from './letter-field-values-cleanup.handler.js';

/** #582: удаление атрибута письма чистит `letters.custom_fields` по событию. */

const FIELD = '58200000-0000-4000-8000-000000000001';

function makeHandler() {
  const letters = { removeCustomFieldValues: vi.fn(async () => 2) };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handler = new LetterFieldValuesCleanupHandler(letters as never, logger as never);
  return { handler, letters, logger };
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

describe('LetterFieldValuesCleanupHandler (#582)', () => {
  it('область letter, change=deleted — чистит значения писем', async () => {
    const { handler, letters, logger } = makeHandler();
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(letters.removeCustomFieldValues).toHaveBeenCalledWith(FIELD);
    expect(logger.debug).toHaveBeenCalledWith(
      { fieldId: FIELD, removed: 2 },
      'Значения удалённого атрибута убраны из писем',
    );
  });

  it('чужие области, изменения и невалидный payload игнорируются', async () => {
    const { handler, letters } = makeHandler();

    await handler.handle(event({ definitionId: FIELD, scope: 'letter', change: 'updated' }));
    await handler.handle(event({ definitionId: 'не-uuid', change: 'deleted' }));
    expect(letters.removeCustomFieldValues).not.toHaveBeenCalled();
  });

  it('повторная доставка идемпотентна: репозиторий вызывается снова, удаляет только остатки', async () => {
    const { handler, letters } = makeHandler();
    letters.removeCustomFieldValues.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    await handler.handle(event({ definitionId: FIELD, change: 'deleted' }));
    expect(letters.removeCustomFieldValues).toHaveBeenCalledTimes(2);
  });
});
