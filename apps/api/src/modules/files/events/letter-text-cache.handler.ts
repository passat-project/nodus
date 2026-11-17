import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CORRESPONDENCE_EVENTS, type DomainEvent, type DomainEventHandler } from '@nodus/contracts';

import { FilesRepository } from '../files.repository.js';

/**
 * Приватность кэша текста вложений (#922, ADR-0050): текст, извлечённый до
 * того, как письмо стало конфиденциальным, не должен лежать at rest — иначе
 * смена флага закрывает только маршрут, а данные остаются. Связь модулей
 * событием (I3): files читает из payload только id файлов.
 */
@Injectable()
export class LetterConfidentialTextHandler implements DomainEventHandler<Record<string, unknown>> {
  static readonly eventType = CORRESPONDENCE_EVENTS.LETTER_UPDATED;

  constructor(
    private readonly files: FilesRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterConfidentialTextHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    if (event.payload?.confidential !== true) return;
    await dropTextCache(this.files, this.logger, event.payload?.fileIds, 'letter_confidential');
  }
}

/** Удаление письма: вложений больше нет — кэш текста тоже не нужен. */
@Injectable()
export class LetterDeletedTextHandler implements DomainEventHandler<Record<string, unknown>> {
  static readonly eventType = CORRESPONDENCE_EVENTS.LETTER_DELETED;

  constructor(
    private readonly files: FilesRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterDeletedTextHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    await dropTextCache(this.files, this.logger, event.payload?.fileIds, 'letter_deleted');
  }
}

async function dropTextCache(
  files: FilesRepository,
  logger: PinoLogger,
  rawFileIds: unknown,
  reason: 'letter_confidential' | 'letter_deleted',
): Promise<void> {
  if (!Array.isArray(rawFileIds)) return;
  const fileIds = rawFileIds.filter((id): id is string => typeof id === 'string');
  const removed = await files.deleteTextExtracts(fileIds);
  if (removed > 0) {
    logger.info({ reason, removed, files: fileIds.length }, 'Text cache dropped');
  }
}
