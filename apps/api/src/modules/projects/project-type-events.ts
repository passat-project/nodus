import { PROJECT_EVENTS } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import type { EventBus } from '../../core/events/event-bus.js';

/** Каталожное событие типа проекта (#631, Р10): форма, привязки и
 *  справочные поля перечитываются у всех клиентов без F5. Вынесено из
 *  контроллера ради лимита строк (I5). */
export function emitProjectTypeChanged(
  eventBus: EventBus,
  tx: TransactionClient,
  typeId: string,
  change: 'created' | 'updated' | 'archived' | 'restored',
  fields: string[],
  actorId: string | null,
): Promise<void> {
  return eventBus.emit(
    tx,
    PROJECT_EVENTS.TYPE_CHANGED,
    { typeId, change, fields },
    { actorId, aggregateType: 'project_type', aggregateId: typeId },
  );
}
