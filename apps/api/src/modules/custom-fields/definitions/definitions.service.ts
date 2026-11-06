import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  CreateCustomFieldBody,
  CustomFieldBindings,
  CustomFieldDefinition,
  CustomFieldModule,
  CustomFieldUsage,
  CustomFieldValue,
  ReorderCustomFieldsBody,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS, ErrorCode } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
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
  FIELD_BINDING_TARGET_READER,
  type FieldBindingTargetReader,
} from '../../projects/ports/field-binding-targets.port.js';
import {
  FIELD_BINDING_FORM_CLEANER,
  type FieldBindingFormCleaner,
} from '../../projects/ports/field-binding-form-cleaner.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import {
  WORKFLOW_FIELD_USAGE_READER,
  type WorkflowFieldUsageReader,
} from '../../workflows/ports/workflow-field-usage.port.js';
import { DefinitionMapper, type FieldDefinitionRow } from './definition.mapper.js';
import { DefinitionsUsageService } from './definitions-usage.service.js';
import { emitDefinitionChanged } from './definition-events.js';
import {
  assertBindingsUsable,
  assertSettingsUsable,
  assertUpdateAllowed,
  nameTaken,
  replaceBindings,
  requireDefinition,
} from './definition-guards.js';
import { DefinitionsRepository, type FieldDefinitionWriteData } from './definitions.repository.js';
import { CustomFieldValueValidator } from '../values/value-validator.js';

/**
 * Реестр определений атрибутов портала (#631, ADR-0037 п.2): CRUD,
 * привязки «Где используется», глобальные переменные, порядок. Имя
 * уникально глобально под advisory-локом (один ключ на портал, Р1);
 * создание дубля — 409 с suggestion существующего (В3); удаление разрешено
 * ВСЕГДА (Р8) — окно последствий показывает usage; потолок портала 1000
 * (Р12, техническая страховка). Мутации — транзакция + outbox
 * `custom_field.definition_changed` (I9), аудит — контроллером.
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
    @Inject(FIELD_BINDING_TARGET_READER) private readonly targets: FieldBindingTargetReader,
    @Inject(FIELD_BINDING_FORM_CLEANER) private readonly formCleaner: FieldBindingFormCleaner,
    private readonly usageReader: DefinitionsUsageService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DefinitionsService.name);
  }

  /** Реестр портала; `module` — фильтр по привязкам/категории (Р11). */
  async list(module: CustomFieldModule | null): Promise<CustomFieldDefinition[]> {
    const rows = await this.definitions.list();
    if (!module) return this.mapper.toDtos(rows);
    if (module === 'company') return this.mapper.toDtos(rows.filter((row) => row.isCompany));
    if (module === 'project' || module === 'node') {
      const kind = module === 'project' ? 'project_type' : 'node_kind';
      return this.mapper.toDtos(
        rows.filter((row) => row.bindings.some((b) => b.targetKind === kind)),
      );
    }
    // task/letter: привязка к живому типу своей категории (типы письма не
    // делают атрибут «задачным» и наоборот).
    const refs = await this.catalog.typeRefs(
      rows.flatMap((row) =>
        row.bindings.filter((b) => b.targetKind === 'process_type').map((b) => b.targetId),
      ),
      { live: true },
    );
    const categoryTypes = new Set(
      refs.filter((ref) => ref.category === module).map((ref) => ref.id),
    );
    return this.mapper.toDtos(
      rows.filter((row) =>
        row.bindings.some((b) => b.targetKind === 'process_type' && categoryTypes.has(b.targetId)),
      ),
    );
  }

  async create(dto: CreateCustomFieldBody, actorId: string): Promise<CustomFieldDefinition> {
    await assertSettingsUsable(
      this.dictionaries,
      dto.type,
      dto.settings?.dictionaryId,
      dto.settings?.currencyId,
    );
    const bindings = dto.isCompany
      ? { processTypeIds: [] as const, projectTypeIds: [] as const, nodeKindIds: [] as const }
      : (dto.bindings ?? {
          processTypeIds: [] as const,
          projectTypeIds: [] as const,
          nodeKindIds: [] as const,
        });
    await assertBindingsUsable(this.catalog, this.targets, bindings);

    return this.txRunner.run(async (tx) => {
      await this.definitions.lockRegistry(tx);
      const taken = await this.definitions.findByName(dto.name, null, tx);
      if (taken) throw nameTaken(taken.id, taken.name);
      if ((await this.definitions.countAll(tx)) >= CUSTOM_FIELD_LIMITS.portal) {
        throw new DomainException(
          ErrorCode.CUSTOM_FIELD_LIMIT_REACHED,
          'Custom field limit reached',
          { limit: CUSTOM_FIELD_LIMITS.portal },
        );
      }
      const number = await this.definitions.nextNumber(tx);
      const sortOrder = (await this.definitions.maxSortOrder(tx)) + 1;
      const data: FieldDefinitionWriteData = {
        number,
        type: dto.type,
        name: dto.name,
        hint: dto.hint ?? null,
        settings: dto.settings as FieldDefinitionWriteData['settings'],
        defaultValue: (dto.defaultValue ?? null) as FieldDefinitionWriteData['defaultValue'],
        reportIndexed: dto.reportIndexed,
        isCompany: dto.isCompany,
        sortOrder,
        createdById: actorId,
      };
      const created = await this.definitions.create(data, tx);
      await replaceBindings(this.definitions, created.id, bindings, tx);
      const row = (await this.definitions.findById(created.id, tx)) ?? created;
      await this.emitChanged(tx, row, 'created', actorId, [
        ...Object.keys(data).filter((key) => key !== 'number'),
        'bindings',
      ]);
      return this.mapper.toDto(row, tx);
    });
  }

  async update(
    id: string,
    dto: UpdateCustomFieldBody,
    actorId: string,
  ): Promise<CustomFieldDefinition> {
    const current = await requireDefinition(this.definitions, id);
    const { nextSettings, nextDefault } = await assertUpdateAllowed(
      {
        mapper: this.mapper,
        validator: this.validator,
        dictionaries: this.dictionaries,
        catalog: this.catalog,
        targets: this.targets,
      },
      id,
      current,
      dto,
    );

    return this.txRunner.run(async (tx) => {
      await this.definitions.lockRegistry(tx);
      if (dto.name !== undefined && dto.name !== current.name) {
        const taken = await this.definitions.findByName(dto.name, id, tx);
        if (taken) throw nameTaken(taken.id, taken.name);
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
      await this.definitions.update(id, data, tx);
      if (dto.bindings !== undefined) {
        await replaceBindings(this.definitions, id, dto.bindings, tx);
        await this.cleanRemovedFormSlots(current, dto.bindings, actorId, tx);
      }
      const row = (await this.definitions.findById(id, tx)) ?? current;
      const fields = Object.keys(data);
      await this.emitChanged(
        tx,
        row,
        'updated',
        actorId,
        dto.bindings === undefined ? fields : [...fields, 'bindings'],
      );
      return this.mapper.toDto(row, tx);
    });
  }

  /** Где используется: агрегат последствий для окна удаления (Р8). */
  async usage(id: string): Promise<CustomFieldUsage> {
    return this.usageReader.usage(await requireDefinition(this.definitions, id));
  }

  /**
   * Удаление — всегда разрешено (Р8, В4): 409 CUSTOM_FIELD_IN_USE снят.
   * Определение + привязки + глобальное значение (каскад) в одной
   * транзакции с событием `deleted`; значения в JSONB сущностей стирают
   * владельцы своими обработчиками (идемпотентно). Опубликованные маршруты
   * с ключом продолжают работать (толерантность unknown-ключа).
   */
  async remove(id: string, actorId: string): Promise<void> {
    const definition = await requireDefinition(this.definitions, id);
    await this.txRunner.run(async (tx) => {
      await this.definitions.remove(id, tx);
      await this.emitChanged(tx, definition, 'deleted', actorId, []);
    });
  }

  /** Порядок атрибутов портала: `ids` — ровно все атрибуты (реестр один). */
  async reorder(dto: ReorderCustomFieldsBody, actorId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      await this.definitions.lockRegistry(tx);
      const rows = await this.definitions.list(tx);
      const expected = new Set(rows.map((row) => row.id));
      if (dto.ids.length !== expected.size || dto.ids.some((id) => !expected.has(id))) {
        throw new DomainException(ErrorCode.CONFLICT, 'Field order is stale');
      }
      const changed = dto.ids.some((id, index) => rows[index]?.id !== id);
      if (!changed) return;
      await this.definitions.applyOrder(dto.ids, tx);
      const anchor = rows[0];
      if (!anchor) return;
      await this.emitChanged(tx, anchor, 'reordered', actorId, ['sortOrder']);
    });
  }

  /**
   * Значение глобальной переменной (Р7): одна строка на компанию (PK =
   * определение, upsert), null — очистка. Грамматика — тип определения.
   * Не-глобальному — 422. Изменение — событие {fields:['companyValue']}
   * (веб-кэш определений слушает).
   */
  async setCompanyValue(
    id: string,
    value: CustomFieldValue | null,
    actor: ProjectActor,
  ): Promise<CustomFieldDefinition> {
    const definition = await requireDefinition(this.definitions, id);
    if (!definition.isCompany) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Field is not a company variable');
    }
    if (value !== null) {
      const dto = await this.mapper.toDto(definition);
      // Актёр нужен ссылочным типам (project/task/letter/node): глобальную
      // переменную-ссылку админ задаёт из реестра, видимость проверяется
      // его глазами (#646). Без актёра любая ссылка получала not_found.
      const issues = await this.validator.validate([dto], { [id]: value }, undefined, actor);
      if (issues.length > 0) {
        throw new DomainException(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Value is invalid', {
          issues,
        });
      }
    }
    return this.txRunner.run(async (tx) => {
      await this.definitions.putCompanyValue(id, value, actor.id, tx);
      const row = (await this.definitions.findById(id, tx)) ?? definition;
      await this.emitChanged(tx, row, 'updated', actor.id, ['companyValue']);
      return this.mapper.toDto(row, tx);
    });
  }

  /** Снятие привязки полным набором (диалог атрибута) — слоты форм мест
   *  убираются синхронно (#646): инвариант «слот = привязка» в обе стороны. */
  private async cleanRemovedFormSlots(
    current: FieldDefinitionRow,
    next: CustomFieldBindings,
    actorId: string,
    tx: TransactionClient,
  ): Promise<void> {
    const removed = current.bindings.filter(
      (binding) =>
        (binding.targetKind === 'project_type' &&
          !next.projectTypeIds.includes(binding.targetId)) ||
        (binding.targetKind === 'node_kind' && !next.nodeKindIds.includes(binding.targetId)),
    );
    for (const binding of removed) {
      await this.formCleaner.removeFieldFromForm(
        { kind: binding.targetKind as 'project_type' | 'node_kind', id: binding.targetId },
        current.id,
        actorId,
        tx,
      );
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
