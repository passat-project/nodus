import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { CounterpartiesRepository } from '../counterparties/counterparties.repository.js';

/**
 * Уборка значений удалённого атрибута у контрагентов (#646): колонка
 * `counterparties.custom_fields` принадлежит crm (I3), событие
 * `custom_field.definition_changed` с `change='deleted'` — единственный
 * законный канал, по которому модуль узнаёт об удалении определения.
 *
 * Идемпотентен: `custom_fields - key` по строкам, где ключ ещё есть;
 * архивных контрагентов тоже чистим — восстановление не должно воскрешать
 * значение удалённого атрибута. Пути записи значений появятся в CRM (Н2),
 * но миграция #631 уже переписывает ключи этой колонки, поэтому уборка
 * нужна сейчас. Имя класса уникально — диспетчер различает обработчики по
 * имени класса (gotcha backend.md).
 */
@Injectable()
export class CounterpartyFieldValuesCleanupHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly counterparties: CounterpartiesRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CounterpartyFieldValuesCleanupHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change !== 'deleted') return;
    const fieldId = parsed.data.definitionId;
    const removed = await this.counterparties.removeCustomFieldValues(fieldId);
    this.logger.debug({ fieldId, removed }, 'Значения удалённого атрибута убраны из контрагентов');
  }
}
