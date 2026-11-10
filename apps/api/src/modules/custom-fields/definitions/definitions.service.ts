/* eslint-disable nodus-internal/max-lines-warn -- реестр атрибутов (#630): правила счётчика и привязки — та же транзакция */
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
import { CUSTOM_FIELD_LIMITS, ErrorCode, Permission } from '@nodus/contracts';

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
import { DefinitionMapper, bindingsOf, type FieldDefinitionRow } from './definition.mapper.js';
import { DefinitionsQueryService } from './definitions-query.service.js';
import { emitDefinitionChanged } from './definition-events.js';
import { CounterRuleService } from './counter-rule.service.js';
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
import { FormulaBindingService } from '../formulas/formula-binding.service.js';
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
/** id справочника из настроек определения (невалидное — null). */
function dictionaryIdOf(settings: unknown): string | null {
  const id = (settings as { dictionaryId?: unknown } | undefined)?.dictionaryId;
  return typeof id === 'string' ? id : null;
}

/**
 * #604: работа со справочником требует `dictionary.manage` (I8 — сервер не
 * доверяет UI #491). Триггеры: появился/сменился `settings.dictionaryId` или
 * тип переводится в списковое семейство. Правка имени/подсказки/умолчания
 * существующего списка с одним `custom_field.manage` разрешена — контракт
 * #491. Fail-closed: забытый вызывающим список прав = отказ, не обход.
 */
function assertDictionaryManage(
  permissions: readonly string[],
  current: { type: string; settings: unknown } | null,
  nextType: string,
  nextSettings: unknown,
): void {
  if (permissions.includes(Permission.DICTIONARY_MANAGE)) return;
  const nextDictionaryId = dictionaryIdOf(nextSettings);
  const currentDictionaryId = dictionaryIdOf(current?.settings);
  const becomesList = nextType === 'enum' || nextType === 'multienum';
  const wasList = current?.type === 'enum' || current?.type === 'multienum';
  if (nextDictionaryId !== currentDictionaryId || (becomesList && !wasList)) {
    throw DomainException.forbidden('Dictionary management permission required', {
      permission: Permission.DICTIONARY_MANAGE,
    });
  }
}

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
    private readonly bindingFormulas: FormulaBindingService,
    private readonly counterRules: CounterRuleService,
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

  async create(
    dto: CreateCustomFieldBody,
    actorId: string,
    permissions: readonly string[] = [],
  ): Promise<CustomFieldDefinition> {
    // #604: список на существующем справочнике — это управление справочником.
    // Проверка ДО существования словаря: 403, а не 404/422-оракул (I8).
    assertDictionaryManage(permissions, null, dto.type, dto.settings);
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
    // Правило счётчика (#630): проверки формы, достижимости привязок и
    // «при создании» — ДО мутации; номер при создании не тратится.
    this.counterRules.assertShape(dto.type, dto);
    const onCreate = dto.numberingOnCreate ?? [];
    if (dto.numbering) {
      await this.counterRules.assertReachable(dto.numbering, bindings);
      await this.counterRules.assertTriggers(dto.numbering, onCreate, bindings);
    }

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
      let row = (await this.definitions.findById(created.id, tx)) ?? created;
      // Счётчик (#630): серия 1:1 с определением, флаги «при создании» на
      // привязках и продолжение сквозного счёта — той же транзакцией.
      if (dto.type === 'counter' && dto.numbering) {
        const seriesId = await this.counterRules.applyRule(
          tx,
          created.id,
          null,
          dto.name,
          dto.numbering,
        );
        await this.counterRules.applyOnCreate(tx, created.id, onCreate);
        await this.counterRules.applyNext(tx, seriesId, dto.numberingNext);
        row = (await this.definitions.findById(created.id, tx)) ?? row;
      }
      // Формулы мест в том же диалоге (Г-1 #632): раньше тело молча
      // игнорировалось сервером — формула типа ставилась только в моках.
      if (dto.bindingFormulas && Object.keys(dto.bindingFormulas).length > 0) {
        await this.bindingFormulas.applyWithinTx(tx, row, dto.bindingFormulas, actorId);
        // Ответ API обязан нести только что сохранённые формулы мест —
        // перечитываем строку ПОСЛЕ записи (симметрично update).
        row = (await this.definitions.findById(created.id, tx)) ?? row;
      }
      await this.emitChanged(tx, row, 'created', actorId, [
        // Только поля DTO: `number` и `createdById` — внутренние колонки.
        ...Object.keys(data).filter((key) => key !== 'number' && key !== 'createdById'),
        'bindings',
        ...(dto.bindingFormulas ? ['defaultFormula'] : []),
        ...(dto.numbering ? ['numberSeriesId', 'numberOnCreate'] : []),
      ]);
      return this.mapper.toDto(row, tx);
    });
  }

  async update(
    id: string,
    dto: UpdateCustomFieldBody,
    actorId: string,
    permissions: readonly string[] = [],
  ): Promise<CustomFieldDefinition> {
    const current = await requireDefinition(this.definitions, id);
    // #604: смена dictionaryId (в т.ч. первый после типа) или перевод типа в
    // списковое семейство — управление справочником. Проверка ДО существования
    // словаря: 403, а не 404/422-оракул (I8). Правка имени/подсказки/умолчания
    // существующего списка остаётся с одним custom_field.manage.
    assertDictionaryManage(permissions, current, dto.type ?? current.type, {
      ...(current.settings as Record<string, unknown>),
      ...(dto.settings ?? {}),
    });
    const { nextType, nextSettings, nextDefault } = await assertUpdateAllowed(
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
    this.counterRules.assertShape(nextType, dto);

    return this.txRunner.run(async (tx) => {
      await this.definitions.lockRegistry(tx);
      // Снимок привязок для дельты слотов — под локом и в транзакции:
      // внешний `current` мог устареть между чтением и мутацией (#646).
      const fresh = (await this.definitions.findById(id, tx)) ?? current;
      // Счётчик (#630): условия после выдач заморожены, привязки достижимы,
      // «при создании» — у привязанных типов. Проверки ДО мутации.
      const nextBindings = dto.bindings ?? bindingsOf(fresh);
      const currentOnCreate = fresh.bindings
        .filter((binding) => binding.numberOnCreate === true)
        .map((binding) => binding.targetId);
      const boundIds = new Set([
        ...nextBindings.processTypeIds,
        ...nextBindings.projectTypeIds,
        ...nextBindings.nodeKindIds,
      ]);
      const nextOnCreate =
        dto.numberingOnCreate ?? currentOnCreate.filter((targetId) => boundIds.has(targetId));
      const currentRule =
        nextType === 'counter' && fresh.numberSeriesId
          ? await this.counterRules.ruleOf(tx, fresh.numberSeriesId)
          : null;
      const nextRule = dto.numbering ?? currentRule;
      if (dto.numbering) {
        await this.counterRules.assertReachable(dto.numbering, nextBindings);
        await this.counterRules.assertNotLocked(tx, fresh.numberSeriesId ?? null, dto.numbering);
      }
      if (nextType === 'counter' && nextRule) {
        await this.counterRules.assertTriggers(nextRule, nextOnCreate, nextBindings);
      }
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
      // Формулы мест в том же диалоге (Г-1 #632): замена набора целиком,
      // после замены привязок — формулы валидны против свежих целей.
      if (dto.bindingFormulas !== undefined) {
        const withBindings = (await this.definitions.findById(id, tx)) ?? fresh;
        await this.bindingFormulas.applyWithinTx(tx, withBindings, dto.bindingFormulas, actorId);
      }
      // Счётчик (#630): правило и «при создании» — после замены привязок
      // (флаг живёт на привязке), той же транзакцией.
      if (nextType === 'counter' && dto.numbering) {
        await this.counterRules.applyRule(
          tx,
          id,
          fresh.numberSeriesId ?? null,
          fresh.name,
          dto.numbering,
        );
      }
      if (
        nextType === 'counter' &&
        (dto.numberingOnCreate !== undefined || dto.bindings !== undefined)
      ) {
        await this.counterRules.applyOnCreate(tx, id, nextOnCreate);
      }
      const row = (await this.definitions.findById(id, tx)) ?? fresh;
      const fields = Object.keys(data);
      await this.emitChanged(tx, row, 'updated', actorId, [
        ...(dto.bindings === undefined ? fields : [...fields, 'bindings']),
        ...(dto.bindingFormulas !== undefined ? ['defaultFormula'] : []),
        ...(dto.numbering !== undefined ? ['numberSeriesId'] : []),
        ...(dto.numberingOnCreate !== undefined ? ['numberOnCreate'] : []),
      ]);
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
