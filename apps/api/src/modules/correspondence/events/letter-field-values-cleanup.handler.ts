import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { LettersRepository } from '../letters/letters.repository.js';

/**
 * Уборка значений удалённого атрибута письма (#582): колонка
 * `letters.custom_fields` принадлежит correspondence (I3), событие
 * `custom_field.definition_changed` с `change='deleted'` — единственный
 * законный канал, по которому модуль узнаёт об удалении определения.
 *
 * Идемпотентен: `custom_fields - key` по строкам, где ключ ещё есть; мягко
 * удалённые письма тоже чистим — восстановление не должно воскрешать значение
 * удалённого атрибута. Имя класса уникально — диспетчер различает обработчики
 * по имени класса (gotcha backend.md).
 */
@Injectable()
export class LetterFieldValuesCleanupHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly letters: LettersRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFieldValuesCleanupHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change !== 'deleted') return;
    if (parsed.data.scope !== 'letter') return;
    const fieldId = parsed.data.definitionId;
    const removed = await this.letters.removeCustomFieldValues(fieldId);
    this.logger.debug({ fieldId, removed }, 'Значения удалённого атрибута убраны из писем');
  }
}
