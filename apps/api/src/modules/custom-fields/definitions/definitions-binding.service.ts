import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  FIELD_BINDING_TARGET_READER,
  type FieldBindingTargetReader,
} from '../../projects/ports/field-binding-targets.port.js';
import {
  FIELD_BINDING_FORM_CLEANER,
  type FieldBindingFormCleaner,
} from '../../projects/ports/field-binding-form-cleaner.port.js';
import { DefinitionMapper, type FieldDefinitionRow } from './definition.mapper.js';
import { emitDefinitionChanged } from './definition-events.js';
import {
  assertTargetsBindable,
  bindingRowKind,
  type BindingTargetKind,
} from './binding-targets.js';
import { DefinitionsRepository } from './definitions.repository.js';

/**
 * Точечные привязки «Где используется» (Р3 #631): PUT/DELETE
 * `/definitions/:id/bindings/:kind/:targetId`. Вынесено из DefinitionsService,
 * чтобы реестр оставался в лимите строк (I5). Обе операции идемпотентны:
 * повтор — не ошибка, событие всё равно уходит — кэши владельцев сходятся.
 *
 * Снятие привязки разрешено ВСЕГДА (О3 #631): заполненные значения не
 * стираются, опубликованные маршруты с ключом продолжают работать
 * (толерантность unknown-ключа), повторная публикация с непривязанным
 * ключом — ошибка `custom_field_not_in_type` как раньше.
 */
@Injectable()
export class DefinitionsBindingService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    private readonly mapper: DefinitionMapper,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(FIELD_BINDING_TARGET_READER) private readonly targets: FieldBindingTargetReader,
    @Inject(FIELD_BINDING_FORM_CLEANER) private readonly formCleaner: FieldBindingFormCleaner,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DefinitionsBindingService.name);
  }

  async bind(
    id: string,
    kind: BindingTargetKind,
    targetId: string,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    const definition = await this.require(id);
    assertNotCompany(definition, kind, targetId);
    await assertTargetsBindable(this.catalog, this.targets, kind, [targetId]);
    return this.txRunner.run(async (tx) => {
      await this.definitions.bindTarget(id, bindingRowKind(kind), targetId, tx);
      return this.afterChange(tx, id, actorId);
    });
  }

  async unbind(
    id: string,
    kind: BindingTargetKind,
    targetId: string,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    const definition = await this.require(id);
    assertNotCompany(definition, kind, targetId);
    // Снятие разрешено ВСЕГДА (О3): цель могла быть заархивирована или
    // удалена — привязка-сирота не должна блокировать уборку (N-5 #646).
    return this.txRunner.run(async (tx) => {
      await this.definitions.unbindTarget(id, bindingRowKind(kind), targetId, tx);
      const rowKind = bindingRowKind(kind);
      if (rowKind !== 'process_type') {
        await this.formCleaner.removeFieldFromForm(
          { kind: rowKind, id: targetId },
          id,
          actorId,
          tx,
        );
      }
      return this.afterChange(tx, id, actorId);
    });
  }

  private async require(id: string): Promise<FieldDefinitionRow> {
    const row = await this.definitions.findById(id);
    if (!row) throw DomainException.notFound('Custom field not found', { definitionId: id });
    return row;
  }

  private async afterChange(
    tx: TransactionClient,
    id: string,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    const row = await this.definitions.findById(id, tx);
    if (!row) throw DomainException.notFound('Custom field not found', { definitionId: id });
    await emitDefinitionChanged(
      { eventBus: this.eventBus, logger: this.logger },
      tx,
      row,
      'updated',
      actorId,
      ['bindings'],
    );
    return this.mapper.toDto(row, tx);
  }
}

function assertNotCompany(
  definition: FieldDefinitionRow,
  kind: BindingTargetKind,
  targetId: string,
): void {
  if (definition.isCompany) {
    throw new DomainException(
      ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
      'Company variable cannot have bindings',
      { targetKind: kind, targetId },
    );
  }
}
