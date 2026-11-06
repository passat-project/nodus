import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TaskFactsRepository } from '../tasks/task-facts.repository.js';

/**
 * Уборка значений удалённого атрибута (#431, вердикт владельца 25.10.2026:
 * удаление стирает значения). Определение живёт в модуле custom-fields,
 * колонка `tasks.custom_fields` — здесь (I3): событие
 * `custom_field.definition_changed` с `change='deleted'` — единственный
 * законный канал, по которому задачи узнают об удалении.
 *
 * Идемпотентен: `custom_fields - key` по строкам, где ключ ещё есть; повторная
 * доставка события ничего не меняет. Мягко удалённые задачи тоже чистим —
 * восстановление не должно воскрешать значение удалённого атрибута.
 *
 * Уборка идёт пачками (не одна транзакция на таблицу). Оборванная на середине
 * не теряется: outbox доставляет событие at-least-once, и повторный проход
 * дочищает остаток; «осиротевший» ключ без определения не читается никем
 * (валидатор отвечает `unknown`, гидратор ссылок его пропускает).
 */
@Injectable()
export class CustomFieldValuesCleanupHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly facts: TaskFactsRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CustomFieldValuesCleanupHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change !== 'deleted') return;
    const fieldId = parsed.data.definitionId;
    const removed = await this.facts.removeCustomFieldValues(fieldId);
    this.logger.debug({ fieldId, removed }, 'Значения удалённого атрибута убраны из задач');
  }
}
