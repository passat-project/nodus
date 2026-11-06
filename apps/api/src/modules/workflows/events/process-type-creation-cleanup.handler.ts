import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  type DomainEvent,
  type DomainEventHandler,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  PROCESS_TYPE_FORM_CLEANER,
  type ProcessTypeFormCleaner,
} from '../ports/process-type-form-cleaner.port.js';

/**
 * Страховка уборки формы создания маршрута при удалении атрибута (#646):
 * синхронный путь снимает слоты по снимку привязок в транзакции удаления;
 * этот обработчик добирает случаи, где привязка появилась конкурентно или
 * снимок устарел. Идемпотентен — повторная доставка ничего не меняет.
 *
 * Без события остаётся дыра: required-слот `cf.<id>` удалённого атрибута
 * блокирует создание задачи типа, а подать значение нельзя (`unknown`).
 */
@Injectable()
export class ProcessTypeCreationCleanupHandler implements DomainEventHandler<
  Record<string, unknown>
> {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    @Inject(PROCESS_TYPE_FORM_CLEANER) private readonly cleaner: ProcessTypeFormCleaner,
  ) {}

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change !== 'deleted') return;
    await this.txRunner.run((tx) =>
      this.cleaner.removeFieldFromCreationForms(
        parsed.data.definitionId,
        event.actorId ?? null,
        tx,
      ),
    );
  }
}
