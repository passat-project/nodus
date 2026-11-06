import { Injectable } from '@nestjs/common';
import { PROJECT_EVENTS } from '@nodus/contracts';

import { EventBus } from '../../../core/events/event-bus.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { NodeKindsRepository } from '../project-node-kinds.repository.js';
import { ProjectTypesRepository } from '../project-types.repository.js';
import { emitProjectTypeChanged } from '../project-type-events.js';
import type { FieldBindingFormCleaner } from './field-binding-form-cleaner.port.js';

/** Уборка слота формы места при снятии привязки (#646): project_type —
 *  `project_types.form` + событие `project.type_changed`, node_kind —
 *  `node_kinds.config.form` + событие `project.node_kind_changed`. Оба пути
 *  берут advisory-лок справочника: форма места и привязки сериализуются. */
@Injectable()
export class FieldBindingFormCleanerProvider implements FieldBindingFormCleaner {
  constructor(
    private readonly types: ProjectTypesRepository,
    private readonly kinds: NodeKindsRepository,
    private readonly eventBus: EventBus,
  ) {}

  async removeFieldFromForm(
    target: { kind: 'project_type' | 'node_kind'; id: string },
    fieldId: string,
    actorId: string | null,
    tx: TransactionClient,
  ): Promise<void> {
    if (target.kind === 'project_type') {
      await this.types.lockForms(tx);
      const changed = await this.types.removeFieldFromForm(tx, target.id, fieldId);
      if (!changed) return;
      await emitProjectTypeChanged(this.eventBus, tx, target.id, 'updated', ['form'], actorId);
      return;
    }
    await this.kinds.lockForms(tx);
    const changed = await this.kinds.removeFieldFromForm(tx, target.id, fieldId);
    if (!changed) return;
    await this.eventBus.emit(
      tx,
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      { kindId: target.id, change: 'updated', fields: ['form'] },
      { actorId, aggregateType: 'node_kind', aggregateId: target.id },
    );
  }
}
