import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CUSTOM_FIELD_EVENTS,
  PROJECT_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { NodeKindsRepository } from '../project-node-kinds.repository.js';
import { ProjectNodesRepository } from '../project-nodes.repository.js';
import { ProjectTypesRepository } from '../project-types.repository.js';
import { ProjectsRepository } from '../projects.repository.js';
import { emitProjectTypeChanged } from '../project-type-events.js';

/**
 * Уборка значений удалённого атрибута в проектах и папках (#556, Р11):
 * определение живёт в модуле custom-fields, колонки `projects.custom_fields`
 * и `project_nodes.custom_fields` — здесь (I3). Событие
 * `custom_field.definition_changed` с `change='deleted'` — единственный
 * законный канал.
 *
 * Область `node`: ключ убирается из значений папок и из форм ВСЕХ видов
 * (иначе форма ссылалась бы на удалённый атрибут и создание папки падало бы);
 * на каждый переписанный вид — `project.node_kind_changed` в той же
 * транзакции. Область `project`: ключ убирается из значений проектов (F1).
 *
 * Идемпотентен (повторная доставка ничего не меняет) и не проверяет фичефлаг
 * `projects`: гигиена данных при выключенном модуле тоже нужна (C17).
 * Имя класса уникально — диспетчер различает обработчики по имени класса
 * (у задач — CustomFieldValuesCleanupHandler; gotcha backend.md).
 */
@Injectable()
export class ProjectFieldValuesCleanupHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly projects: ProjectsRepository,
    private readonly nodes: ProjectNodesRepository,
    private readonly kinds: NodeKindsRepository,
    private readonly types: ProjectTypesRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFieldValuesCleanupHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change !== 'deleted') return;
    // Без областей (#631): чистим свои таблицы безусловно — ключ либо есть,
    // либо нет (идемпотентно).
    const { definitionId } = parsed.data;
    const projectRemoved = await this.txRunner.run((tx) =>
      this.projects.removeCustomFieldValues(tx, definitionId),
    );
    this.logger.debug(
      { fieldId: definitionId, removed: projectRemoved },
      'Значения удалённого атрибута убраны из проектов',
    );

    await this.txRunner.run(async (tx) => {
      await this.types.lockForms(tx);
      const removed = await this.types.removeFieldFromForms(tx, definitionId);
      // Форма типа изменилась внешним путём — каталожное событие, иначе
      // открытая панель типа сохранит мёртвый слот и получит 422 (#646).
      for (const type of removed) {
        await emitProjectTypeChanged(
          this.eventBus,
          tx,
          type.id,
          'updated',
          ['form'],
          event.actorId,
        );
      }
      this.logger.debug(
        { fieldId: definitionId, removed: removed.length },
        'Слоты удалённого атрибута убраны из форм типов проектов',
      );
    });

    await this.txRunner.run(async (tx) => {
      await this.kinds.lockForms(tx);
      const removed = await this.nodes.removeCustomFieldValues(tx, definitionId);
      const kinds = await this.kinds.removeFieldFromForms(tx, definitionId);
      for (const kind of kinds) {
        await this.eventBus.emit(
          tx,
          PROJECT_EVENTS.NODE_KIND_CHANGED,
          { kindId: kind.id, change: 'updated', fields: ['form'] },
          {
            actorId: event.actorId,
            aggregateType: 'node_kind',
            aggregateId: kind.id,
          },
        );
      }
      this.logger.debug(
        { fieldId: definitionId, removed, kinds: kinds.map((kind) => kind.id) },
        'Значения удалённого атрибута убраны из папок и форм видов',
      );
    });
  }
}
