import { Injectable } from '@nestjs/common';
import {
  PROJECT_EVENTS,
  WORKFLOW_EVENTS,
  normalizeTypeConfig,
  projectTypeChangedPayloadSchema,
  withProjectTypeAllowed,
  type DomainEvent,
  type DomainEventHandler,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { ProcessTypesRepository } from '../types/process-types.repository.js';

/**
 * Свежий тип проекта (`project.type_changed`, change=created, без
 * sourceTypeId) стартует с ПУСТЫМ списком подключённых типов задач (#857,
 * модель связей): владелец подключает типы сам — пикером из справочника.
 * До этого новый тип «разрешал всё» автоматически (модель исключений с
 * пустым списком = «везде», #665) — список «Что здесь можно создавать»
 * оказывался заполнен целиком.
 *
 * Копия типа проекта (sourceTypeId) сюда НЕ попадает: её подключения
 * наследует подписчик `project.type_copied` — исключение основы
 * повторяется, разрешённые основой остаются разрешёнными.
 *
 * Письма не трогаем: их поток системный (ADR-0027), регистрация входящих
 * в проектах нового типа не должна зависеть от этой настройки. Правка —
 * тем же путём, что и окно типа (#665): только секция creation, без
 * отметки customizedAt, событие `workflow.type_updated` — outbox в той же
 * транзакции. Идемпотентен: повторная доставка пропускает типы, уже
 * несущие новый id.
 */
@Injectable()
export class ProjectTypeCreatedScopeHandler implements DomainEventHandler<Record<string, unknown>> {
  static readonly eventType = PROJECT_EVENTS.TYPE_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly types: ProcessTypesRepository,
    private readonly eventBus: EventBus,
  ) {}

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectTypeChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change !== 'created') return;
    if (parsed.data.sourceTypeId !== undefined) return;
    const typeId = parsed.data.typeId;
    const affected = await this.types.list('exclude', 'task');
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
