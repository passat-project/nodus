import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldModule,
  CustomFieldUsage,
  CustomFieldValue,
  ReorderCustomFieldsBody,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS, ErrorCode } from '@nodus/contracts';

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
  FIELD_BINDING_TARGET_READER,
  type FieldBindingTargetReader,
} from '../../projects/ports/field-binding-targets.port.js';
import {
  FIELD_BINDING_FORM_CLEANER,
  type FieldBindingFormCleaner,
} from '../../projects/ports/field-binding-form-cleaner.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import {
  PROCESS_TYPE_FORM_CLEANER,
  type ProcessTypeFormCleaner,
} from '../../workflows/ports/process-type-form-cleaner.port.js';
import { DefinitionMapper, type FieldDefinitionRow } from './definition.mapper.js';
import { DefinitionsQueryService } from './definitions-query.service.js';
import { emitDefinitionChanged } from './definition-events.js';
import {
  assertBindingsUsable,
  createBindings,
  assertDefaultUsable,
  assertSettingsUsable,
  assertUpdateAllowed,
  nameTaken,
  cleanRemovedFormSlots,
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
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(FIELD_BINDING_TARGET_READER) private readonly targets: FieldBindingTargetReader,
    @Inject(FIELD_BINDING_FORM_CLEANER) private readonly formCleaner: FieldBindingFormCleaner,
    @Inject(PROCESS_TYPE_FORM_CLEANER) private readonly processTypeCleaner: ProcessTypeFormCleaner,
    private readonly query: DefinitionsQueryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DefinitionsService.name);
  }

  /** Реестр портала; чтения — `DefinitionsQueryService` (I5). */
  list(module: CustomFieldModule | null, actor?: ProjectActor): Promise<CustomFieldDefinition[]> {
    return this.query.list(module, actor);
  }

  async create(dto: CreateCustomFieldBody, actorId: string): Promise<CustomFieldDefinition> {
    await assertSettingsUsable(
      this.dictionaries,
      dto.type,
      dto.settings?.dictionaryId,
      dto.settings?.currencyId,
    );
    await assertDefaultUsable(
      this.validator,
      'new',
      dto.type,
      dto.settings ?? {},
      dto.defaultValue ?? null,
    );
    const bindings = createBindings(dto);
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
        // Только поля DTO: `number` и `createdById` — внутренние колонки.
        ...Object.keys(data).filter((key) => key !== 'number' && key !== 'createdById'),
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
      // Снимок привязок для дельты слотов — под локом и в транзакции:
      // внешний `current` мог устареть между чтением и мутацией (#646).
      const fresh = (await this.definitions.findById(id, tx)) ?? current;
      if (dto.name !== undefined && dto.name !== fresh.name) {
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
        await cleanRemovedFormSlots(
          this.formCleaner,
          fresh,
          dto.bindings,
          actorId,
          tx,
          this.processTypeCleaner,
        );
      }
      const row = (await this.definitions.findById(id, tx)) ?? fresh;
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

  /** Где используется: агрегат последствий (Р8) — `DefinitionsQueryService`. */
  usage(id: string): Promise<CustomFieldUsage> {
    return this.query.usage(id);
  }

  /** Удаление всегда разрешено (Р8, В4); значения стирают владельцы. */
  async remove(id: string, actorId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      await this.definitions.lockRegistry(tx);
      // Привязки читаем В ТРАНЗАКЦИИ под локом реестра (#646): внешний
      // снимок мог не увидеть привязку, добавленную конкурентно, и слот
      // формы остался бы сиротой до асинхронной страховки.
      const definition = await this.definitions.findById(id, tx);
      if (!definition) {
        throw DomainException.notFound('Custom field not found', { definitionId: id });
      }
      // Слоты форм мест снимаем СИНХРОННО, до коммита удаления (#646):
      // обработчик outbox асинхронен (до 1 с), а required-слот удалённого
      // атрибута в этом окне блокирует создание проекта/папки/задачи.
      // Обработчики остаются идемпотентной страховкой для остальных мест.
      for (const binding of definition.bindings) {
        if (binding.targetKind !== 'project_type' && binding.targetKind !== 'node_kind') continue;
        await this.formCleaner.removeFieldFromForm(
          { kind: binding.targetKind as 'project_type' | 'node_kind', id: binding.targetId },
          id,
          actorId,
          tx,
        );
      }
      if (definition.bindings.some((binding) => binding.targetKind === 'process_type')) {
        await this.processTypeCleaner.removeFieldFromCreationForms(id, actorId, tx);
      }
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
      if (
        dto.ids.length !== expected.size ||
        new Set(dto.ids).size !== dto.ids.length ||
        dto.ids.some((id) => !expected.has(id))
      ) {
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
      throw new DomainException(
        ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
        'Field is not a company variable',
        {
          issues: [{ fieldId: id, reason: 'invalid', message: 'Field is not a company variable' }],
        },
      );
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
      // Лок реестра и перечитывание (#646): конкурентное удаление между
      // проверкой и записью давало FK-ошибку → 500 вместо 404.
      await this.definitions.lockRegistry(tx);
      const fresh = await this.definitions.findById(id, tx);
      if (!fresh) throw DomainException.notFound('Custom field not found', { definitionId: id });
      if (!fresh.isCompany) {
        throw new DomainException(
          ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
          'Field is not a company variable',
          {
            issues: [
              { fieldId: id, reason: 'invalid', message: 'Field is not a company variable' },
            ],
          },
        );
      }
      await this.definitions.putCompanyValue(id, value, actor.id, tx);
      const row = (await this.definitions.findById(id, tx)) ?? fresh;
      await this.emitChanged(tx, row, 'updated', actor.id, ['companyValue']);
      return this.mapper.toDto(row, tx, actor);
    });
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
