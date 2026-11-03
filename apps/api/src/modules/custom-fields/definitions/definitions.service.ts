import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldScope,
  CustomFieldUsage,
  ReorderCustomFieldsBody,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import {
  checkDefinitionShape,
  CUSTOM_FIELD_LIMITS,
  ErrorCode,
  isCompatibleTypeChange,
  SystemDictionary,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  WORKFLOW_FIELD_USAGE_READER,
  type WorkflowFieldUsageReader,
} from '../../workflows/ports/workflow-field-usage.port.js';
import { DefinitionMapper, type FieldDefinitionRow } from './definition.mapper.js';
import { DefinitionsUsageService } from './definitions-usage.service.js';
import { emitDefinitionChanged } from './definition-events.js';
import { assertBindable, assertUnbindable } from './type-bindings.js';
import { DefinitionsRepository, type FieldDefinitionWriteData } from './definitions.repository.js';
import { CustomFieldValueValidator } from '../values/value-validator.js';
/**
 * Реестр определений атрибутов (#431, ADR-0029): CRUD, удаление с проверкой
 * использования, порядок; мутации — транзакция + outbox `custom_field.
 * definition_changed` (I9), аудит — контроллером. Имя уникально в области
 * под advisory-локом; лимит 100; смена типа — только расширяющая; справочник
 * списка неизменен; `hidden` заменяет архив.
 */
@Injectable()
export class DefinitionsService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    private readonly mapper: DefinitionMapper,
    private readonly validator: CustomFieldValueValidator,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
    @Inject(WORKFLOW_FIELD_USAGE_READER) private readonly workflows: WorkflowFieldUsageReader,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    private readonly usageReader: DefinitionsUsageService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DefinitionsService.name);
  }

  async list(scope: CustomFieldScope | null): Promise<CustomFieldDefinition[]> {
    const rows = await this.definitions.list(scope);
    return this.mapper.toDtos(rows);
  }

  async create(dto: CreateCustomFieldBody, actorId: string): Promise<CustomFieldDefinition> {
    await this.assertSettingsUsable(dto.type, dto.settings?.dictionaryId, dto.settings?.currencyId);
    // Привязка (#432, Р8): только живые типы своей категории; пусто — атрибут
    // создаётся «нигде не показывается» (осознанный выбор администратора).
    await assertBindable(this.catalog, dto.scope, dto.typeIds ?? []);

    return this.txRunner.run(async (tx) => {
      await this.definitions.lockScope(dto.scope, tx);
      if (await this.definitions.findByName(dto.scope, dto.name, null, tx)) {
        throw nameTaken(dto.name);
      }
      if ((await this.definitions.countInScope(dto.scope, tx)) >= CUSTOM_FIELD_LIMITS.perScope) {
        throw new DomainException(
          ErrorCode.CUSTOM_FIELD_LIMIT_REACHED,
          'Custom field limit reached',
          { scope: dto.scope, limit: CUSTOM_FIELD_LIMITS.perScope },
        );
      }
      const sortOrder = (await this.definitions.maxSortOrder(dto.scope, tx)) + 1;
      const data: FieldDefinitionWriteData = {
        scope: dto.scope,
        type: dto.type,
        name: dto.name,
        hint: dto.hint ?? null,
        settings: dto.settings as FieldDefinitionWriteData['settings'],
        defaultValue: (dto.defaultValue ?? null) as FieldDefinitionWriteData['defaultValue'],
        reportIndexed: dto.reportIndexed,
        hidden: dto.hidden,
        sortOrder,
        createdById: actorId,
      };
      const created = await this.definitions.create(data, tx);
      await this.definitions.replaceTypes(created.id, dto.typeIds ?? [], tx);
      const row = (await this.definitions.findById(created.id, tx)) ?? created;
      const fields = Object.keys(data);
      await this.emitChanged(
        tx,
        row,
        'created',
        actorId,
        dto.typeIds === undefined ? fields : [...fields, 'typeIds'],
      );
      return this.mapper.toDto(row, tx);
    });
  }

  async update(
    id: string,
    dto: UpdateCustomFieldBody,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    const current = await this.requireDefinition(id);
    const nextType = dto.type ?? (current.type as CustomFieldDefinition['type']);
    if (!isCompatibleTypeChange(current.type as CustomFieldDefinition['type'], nextType)) {
      throw new DomainException(
        ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE,
        'Type change is incompatible with stored values',
        { from: current.type, to: nextType },
      );
    }
    const nextSettings = {
      ...(current.settings as CustomFieldDefinition['settings']),
      ...(dto.settings ?? {}),
    };
    const nextDefault =
      dto.defaultValue === undefined
        ? (current.defaultValue as CustomFieldDefinition['defaultValue'])
        : dto.defaultValue;

    const shape = checkDefinitionShape(nextType, nextSettings, nextDefault);
    if (shape.length > 0) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid custom field shape', {
        issues: shape,
      });
    }
    await this.assertSettingsUsable(nextType, nextSettings.dictionaryId, nextSettings.currencyId);
    if (dto.typeIds !== undefined) {
      await assertBindable(this.catalog, current.scope, dto.typeIds);
      // Снятие привязки тем же телом (#432, security-ревью): тип, где атрибут
      // работает в опубликованном маршруте, из набора убрать нельзя.
      await assertUnbindable(
        this.workflows,
        current.scope as CustomFieldScope,
        id,
        current.typeBindings
          .map((binding) => binding.processTypeId)
          .filter((typeId) => !dto.typeIds!.includes(typeId)),
      );
    }
    if (nextDefault?.kind === 'static') {
      const issues = await this.validator.validate(
        current.scope as CustomFieldScope,
        [{ ...(await this.mapper.toDto(current)), type: nextType, settings: nextSettings }],
        { [id]: nextDefault.value },
      );
      if (issues.length > 0) {
        throw new DomainException(
          ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
          'Default value is invalid',
          {
            issues,
          },
        );
      }
    }

    return this.txRunner.run(async (tx) => {
      await this.definitions.lockScope(current.scope, tx);
      if (dto.name !== undefined && dto.name !== current.name) {
        if (await this.definitions.findByName(current.scope, dto.name, id, tx)) {
          throw nameTaken(dto.name);
        }
      }
      const data: Parameters<DefinitionsRepository['update']>[1] = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.hint !== undefined) data.hint = dto.hint;
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.settings !== undefined)
        data.settings = nextSettings as FieldDefinitionWriteData['settings'];
      if (dto.defaultValue !== undefined) {
        data.defaultValue = nextDefault as FieldDefinitionWriteData['defaultValue'];
      }
      if (dto.reportIndexed !== undefined) data.reportIndexed = dto.reportIndexed;
      if (dto.hidden !== undefined) data.hidden = dto.hidden;
      const updated = await this.definitions.update(id, data, tx);
      if (dto.typeIds !== undefined) await this.definitions.replaceTypes(id, dto.typeIds, tx);
      const row =
        dto.typeIds === undefined
          ? updated
          : ((await this.definitions.findById(id, tx)) ?? updated);
      const fields = Object.keys(data);
      await this.emitChanged(
        tx,
        row,
        'updated',
        actorId,
        dto.typeIds === undefined ? fields : [...fields, 'typeIds'],
      );
      return this.mapper.toDto(row, tx);
    });
  }

  /** Где используется: значения — порт владельца области, маршруты и виды папок (#556). */
  async usage(id: string): Promise<CustomFieldUsage> {
    return this.usageReader.usage(await this.requireDefinition(id));
  }

  /**
   * Удаление определения (вердикт владельца 25.10.2026: у атрибутов нет
   * архива — тестовый мусор должен удаляться). Запрещено, пока атрибут стоит
   * в окне перехода или условии «Заполнены поля» опубликованного маршрута:
   * 409 `CUSTOM_FIELD_IN_USE` со списком процессов. Значения стираются
   * владельцами по событию `change='deleted'` (tasks — своим обработчиком).
   */
  async remove(id: string, actorId: string): Promise<void> {
    const definition = await this.requireDefinition(id);
    const scope = definition.scope as CustomFieldScope;
    const workflows = await this.workflows.workflowsUsingField(scope, id);
    if (workflows.length > 0) {
      throw new DomainException(
        ErrorCode.CUSTOM_FIELD_IN_USE,
        'Custom field is used by workflows',
        {
          workflows,
        },
      );
    }
    await this.txRunner.run(async (tx) => {
      await this.definitions.remove(id, tx);
      await this.emitChanged(tx, definition, 'deleted', actorId, []);
    });
  }

  /** Порядок атрибутов области: `ids` — ровно все атрибуты области. */
  async reorder(dto: ReorderCustomFieldsBody, actorId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      await this.definitions.lockScope(dto.scope, tx);
      const rows = await this.definitions.list(dto.scope, tx);
      const expected = new Set(rows.map((row) => row.id));
      if (dto.ids.length !== expected.size || dto.ids.some((id) => !expected.has(id))) {
        throw new DomainException(ErrorCode.CONFLICT, 'Field order is stale', {
          scope: dto.scope,
        });
      }
      const changed = dto.ids.some((id, index) => rows[index]?.id !== id);
      if (!changed) return;
      await this.definitions.applyOrder(dto.ids, tx);
      const anchor = rows[0];
      if (!anchor) return;
      await this.emitChanged(tx, anchor, 'reordered', actorId, ['sortOrder']);
    });
  }

  private async requireDefinition(id: string): Promise<FieldDefinitionRow> {
    const row = await this.definitions.findById(id);
    if (!row) throw DomainException.notFound('Custom field not found', { definitionId: id });
    return row;
  }

  /** Справочник списка и валюта денег обязаны существовать и быть активными. */
  private async assertSettingsUsable(
    type: string,
    dictionaryId: string | undefined,
    currencyId: string | null | undefined,
  ): Promise<void> {
    if ((type === 'enum' || type === 'multienum') && dictionaryId) {
      const [dictionary] = await this.dictionaries.dictionaryRefs([dictionaryId]);
      if (!dictionary) {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Dictionary not found', {
          dictionaryId,
        });
      }
    }
    if (type === 'money' && currencyId) {
      const [item] = await this.dictionaries.itemRefs([currencyId]);
      const [dictionary] = item ? await this.dictionaries.dictionaryRefs([item.dictionaryId]) : [];
      if (!item?.isActive || dictionary?.code !== SystemDictionary.CURRENCY) {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Currency not found', {
          currencyId,
        });
      }
    }
  }

  /** Одна точка события изменения реестра — `definition-events.ts` (#432). */
  private emitChanged(
    tx: Parameters<EventBus['emit']>[0],
    definition: FieldDefinitionRow,
    change: 'created' | 'updated' | 'deleted' | 'reordered',
    actorId: string,
    fields: string[],
  ): Promise<void> {
    return emitDefinitionChanged(
      { eventBus: this.eventBus, logger: this.logger },
      tx,
      definition,
      change,
      actorId,
      fields,
    );
  }
}

function nameTaken(name: string): DomainException {
  return new DomainException(ErrorCode.CUSTOM_FIELD_NAME_TAKEN, 'Field name is taken', { name });
}
