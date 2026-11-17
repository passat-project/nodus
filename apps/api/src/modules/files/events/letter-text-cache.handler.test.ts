import { describe, expect, it, vi } from 'vitest';
import { CORRESPONDENCE_EVENTS, type DomainEvent } from '@nodus/contracts';

import {
  LetterConfidentialTextHandler,
  LetterDeletedTextHandler,
} from './letter-text-cache.handler.js';
import type { FilesRepository } from '../files.repository.js';

/**
 * Приватность кэша текста (#922, ADR-0050): письмо стало конфиденциальным
 * или удалено — извлечённый текст вложений удаляется, а не только закрывается
 * маршрут (security-ревью 18.11.2026).
 */

function repo() {
  return { deleteTextExtracts: vi.fn(async () => 2) };
}

const logger = { setContext: vi.fn(), info: vi.fn() } as never;

function event(payload: Record<string, unknown>): DomainEvent<Record<string, unknown>> {
  return { type: 'event', payload } as DomainEvent<Record<string, unknown>>;
}

describe('LetterConfidentialTextHandler', () => {
  it('включение конфиденциальности удаляет кэш вложений письма', async () => {
    const files = repo();
    const handler = new LetterConfidentialTextHandler(files as unknown as FilesRepository, logger);
    await handler.handle(event({ letterId: 'l-1', confidential: true, fileIds: ['f-1', 'f-2'] }));
    expect(files.deleteTextExtracts).toHaveBeenCalledWith(['f-1', 'f-2']);
  });

  it('обычная правка и выключение флага кэш не трогают', async () => {
    const files = repo();
    const handler = new LetterConfidentialTextHandler(files as unknown as FilesRepository, logger);
    await handler.handle(event({ letterId: 'l-1', confidential: false }));
    await handler.handle(event({ letterId: 'l-1', changes: [] }));
    expect(files.deleteTextExtracts).not.toHaveBeenCalled();
  });

  it('мусор вместо fileIds не роняет обработчик', async () => {
    const files = repo();
    const handler = new LetterConfidentialTextHandler(files as unknown as FilesRepository, logger);
    await handler.handle(event({ letterId: 'l-1', confidential: true, fileIds: 'oops' }));
    expect(files.deleteTextExtracts).not.toHaveBeenCalled();
  });
});

describe('LetterDeletedTextHandler', () => {
  it('удаление письма сносит кэш его вложений', async () => {
    const files = repo();
    const handler = new LetterDeletedTextHandler(files as unknown as FilesRepository, logger);
    await handler.handle(event({ letterId: 'l-1', fileIds: ['f-1'] }));
    expect(files.deleteTextExtracts).toHaveBeenCalledWith(['f-1']);
  });

  it('подписан на событие удаления письма', () => {
    expect(LetterDeletedTextHandler.eventType).toBe(CORRESPONDENCE_EVENTS.LETTER_DELETED);
    expect(LetterConfidentialTextHandler.eventType).toBe(CORRESPONDENCE_EVENTS.LETTER_UPDATED);
  });
});
