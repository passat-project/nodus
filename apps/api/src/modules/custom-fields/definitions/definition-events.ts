import { CUSTOM_FIELD_EVENTS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { EventBus } from '../../../core/events/event-bus.js';
import type { FieldDefinitionRow } from './definition.mapper.js';

/** Что нужно для события изменения определения (структурно — PinoLogger). */
export interface DefinitionEventSink {
  eventBus: Pick<EventBus, 'emit'>;
  logger: { debug: (obj: object, message: string) => void };
}

/**
 * Одно событие на все изменения реестра (#431, Р12; #631 — без области):
 * обработчики-владельцы чистят свои таблицы по `definitionId` безусловно
 * (ключ либо есть, либо нет — идемпотентно), веб инвалидирует кэш
 * определений. Точка эмита обязана быть одна — иначе появится изменение
 * без события.
 */
export async function emitDefinitionChanged(
  sink: DefinitionEventSink,
  tx: TransactionClient,
  definition: Pick<FieldDefinitionRow, 'id'>,
  change: 'created' | 'updated' | 'deleted' | 'reordered',
  actorId: string,
  fields: string[],
): Promise<void> {
  await sink.eventBus.emit(
    tx,
    CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED,
    {
      definitionId: definition.id,
      change,
      ...(fields.length > 0 ? { fields } : {}),
    },
    { actorId, aggregateType: 'field_definition', aggregateId: definition.id },
  );
  sink.logger.debug({ definitionId: definition.id, change }, 'Атрибут изменён');
}
