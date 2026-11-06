import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { CustomFieldDefinition, FormulaHostKind, FormulaNode } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { DefinitionMapper } from '../definitions/definition.mapper.js';
import { emitDefinitionChanged } from '../definitions/definition-events.js';
import { DefinitionsRepository } from '../definitions/definitions.repository.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import { formulaErrorCodeOf } from './formula-api.service.js';
import { FormulaMetaService } from './formula-meta.service.js';

/**
 * Формула места (#632, Р6): AST живёт на привязке «атрибут × тип/вид»
 * (`field_bindings.default_formula`) и вычисляется НА ЧТЕНИИ — у одного
 * атрибута в разных местах разные формулы. Право — `custom_field.manage`
 * (настройка реестра); смена формулы не требует пересчёта (stateless),
 * событие `definition_changed{fields:['defaultFormula']}` инвалидирует
 * определения на фронте.
 */
@Injectable()
export class FormulaBindingService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    private readonly mapper: DefinitionMapper,
    private readonly meta: FormulaMetaService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(FORMULA_ENGINE) private readonly engine: FormulaEngine,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FormulaBindingService.name);
  }

  /** Поставить/заменить формулу места. */
  async setFormula(
    definitionId: string,
    targetId: string,
    ast: FormulaNode,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    return this.write(definitionId, targetId, ast, actorId);
  }

  /** Снять формулу места: значения записей не трогаются (Р6). */
  async removeFormula(
    definitionId: string,
    targetId: string,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    return this.write(definitionId, targetId, null, actorId);
  }

  private async write(
    definitionId: string,
    targetId: string,
    ast: FormulaNode | null,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    const row = await this.definitions.findById(definitionId);
    if (!row) throw DomainException.notFound('Custom field not found', { definitionId });
    if (row.isCompany) {
      throw new DomainException(
        ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
        'Company variable cannot have bindings',
        { definitionId },
      );
    }
    const binding = row.bindings.find((entry) => entry.targetId === targetId);
    if (!binding) {
      throw DomainException.notFound('Field binding not found', { definitionId, targetId });
    }
    const hostKind = await this.hostKindOf(binding.targetKind, targetId);
    if (ast !== null) await this.assertValid(ast, hostKind, row.type);

    return this.txRunner.run(async (tx) => {
      await this.definitions.lockRegistry(tx);
      const updated = await this.definitions.setBindingFormula(
        definitionId,
        binding.targetKind as 'process_type' | 'project_type' | 'node_kind',
        targetId,
        ast as never,
        tx,
      );
      if (!updated) {
        throw DomainException.notFound('Field binding not found', { definitionId, targetId });
      }
      const fresh = await this.definitions.findById(definitionId, tx);
      if (!fresh) throw DomainException.notFound('Custom field not found', { definitionId });
      await emitDefinitionChanged(
        { eventBus: this.eventBus, logger: this.logger },
        tx,
        fresh,
        'updated',
        actorId,
        ['defaultFormula'],
      );
      return this.mapper.toDto(fresh, tx);
    });
  }

  /** Вид носителя по виду привязки: категория типа процесса решает (Р6). */
  private async hostKindOf(targetKind: string, targetId: string): Promise<FormulaHostKind> {
    switch (targetKind) {
      case 'project_type':
        return 'project';
      case 'node_kind':
        return 'node';
      case 'process_type': {
        const type = await this.catalog.typeById(targetId);
        return type?.category === 'letter' ? 'letter' : 'task';
      }
      default:
        throw DomainException.notFound('Field binding not found', { targetId });
    }
  }

  /** Формула места — без related и цепочки папок (стоимость on-read, Р6). */
  private async assertValid(
    ast: FormulaNode,
    hostKind: FormulaHostKind,
    fieldType: string,
  ): Promise<void> {
    const snapshot = await this.meta.snapshot();
    const validation = this.engine.validate(ast, {
      hostKind,
      meta: snapshot.meta,
      targetFieldType: fieldType as never,
      typeDefault: true,
    });
    const blocking = validation.issues.filter((issue) => issue.blocking);
    if (blocking.length === 0) return;
    throw new DomainException(formulaErrorCodeOf(blocking[0]!.code), 'Formula is invalid', {
      issues: blocking,
    });
  }
}
