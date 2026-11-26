import { Injectable } from '@nestjs/common';
import {
  PROJECT_EVENTS,
  WORKFLOW_EVENTS,
  normalizeTypeConfig,
  projectTypeCopiedPayloadSchema,
  withProjectTypeAllowed,
  type DomainEvent,
  type DomainEventHandler,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { ProcessTypesRepository } from '../types/process-types.repository.js';

/**
 * Копия типа проекта (`project.type_copied`, #857): новый тип наследует
 * исключения основы — каждый тип записи (задача и письмо), где основа была
 * исключена из мест создания («где создаётся», #665), исключает и копию.
 * «Разрешено везде» по умолчанию не трогается: типы, основу не исключавшие,
 * копию тоже разрешают.
 *
 * Правка — тем же путём, что и окно типа (#665): только секция creation,
 * без отметки customizedAt (каталог продолжает получать ревизии), событие
 * `workflow.type_updated` — outbox в той же транзакции. Идемпотентен:
 * повторная доставка пропускает типы, уже несущие новый id.
 */
@Injectable()
export class ProjectTypeCopiedScopeHandler implements DomainEventHandler<Record<string, unknown>> {
  static readonly eventType = PROJECT_EVENTS.TYPE_COPIED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly types: ProcessTypesRepository,
    private readonly eventBus: EventBus,
  ) {}

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectTypeCopiedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { typeId, sourceTypeId } = parsed.data;
    const affected = await this.types.listExcludingProjectType(sourceTypeId);
    for (const row of affected) {
      const config = normalizeTypeConfig(row.config);
      if (config.creation.excludedProjectTypeIds.includes(typeId)) continue;
      const next = {
        ...config,
        creation: withProjectTypeAllowed(config.creation, typeId, false),
      };
      // Каждый тип — своей транзакцией: сбой одного не отменяет уже
      // дописанные, повторная доставка добирает пропущенное.
      await this.txRunner.run(async (tx) => {
        await this.types.updateConfig(tx, row.id, next, { markCustomized: false });
        await this.eventBus.emit(
          tx,
          WORKFLOW_EVENTS.TYPE_UPDATED,
          { typeId: row.id, fields: ['config.creation'] },
          { actorId: event.actorId ?? null, aggregateType: 'process_type', aggregateId: row.id },
        );
      });
    }
  }
}
