import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  UpdateCustomFieldBody,
} from '@nodus/contracts';
import {
  checkDefinitionShape,
  ErrorCode,
  isCompatibleTypeChange,
  SystemDictionary,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type { DictionaryReader } from '../../dictionaries/ports/dictionary-reader.port.js';
import type { ProcessCatalogReader } from '../../workflows/ports/process-catalog-reader.port.js';
import type { FieldBindingTargetReader } from '../../projects/ports/field-binding-targets.port.js';
import { assertTargetsBindable } from './binding-targets.js';
import type { DefinitionMapper, FieldDefinitionRow } from './definition.mapper.js';
import type { DefinitionsRepository } from './definitions.repository.js';
import type { FieldBindingFormCleaner } from '../../projects/ports/field-binding-form-cleaner.port.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { CustomFieldValueValidator } from '../values/value-validator.js';

/**
 * Проверки мутаций реестра атрибутов (#631): предусловия правки определения
 * (смена типа, shape настроек, справочник/валюта, привязки, статическое
 * умолчание) и точечные guard-ы (404 определения, 409 дубля имени, замена
 * привязок). Вынесено из DefinitionsService ради лимита строк файла (I5);
 * зависимости передаются явно, логика прежняя.
 */

/** 404 определения: единая точка загрузки строки для мутаций и чтений. */
export async function requireDefinition(
  definitions: DefinitionsRepository,
  id: string,
): Promise<FieldDefinitionRow> {
  const row = await definitions.findById(id);
  if (!row) throw DomainException.notFound('Custom field not found', { definitionId: id });
  return row;
}

/** Привязки тела создания/правки: цели существуют и живые (Р3). */
export async function assertBindingsUsable(
  catalog: ProcessCatalogReader,
  targets: FieldBindingTargetReader,
  bindings: {
    processTypeIds: readonly string[];
    projectTypeIds: readonly string[];
    nodeKindIds: readonly string[];
  },
  opts: { allowArchivedProcessTypeIds?: ReadonlySet<string> } = {},
): Promise<void> {
  await assertTargetsBindable(catalog, targets, 'process-type', bindings.processTypeIds, {
    ...(opts.allowArchivedProcessTypeIds
      ? { allowArchived: opts.allowArchivedProcessTypeIds }
      : {}),
  });
  await assertTargetsBindable(catalog, targets, 'project-type', bindings.projectTypeIds);
  await assertTargetsBindable(catalog, targets, 'node-kind', bindings.nodeKindIds);
}

/** Замена всех трёх наборов привязок (тело с `bindings`). */
export async function replaceBindings(
  definitions: DefinitionsRepository,
  id: string,
  bindings: {
    processTypeIds: readonly string[];
    projectTypeIds: readonly string[];
    nodeKindIds: readonly string[];
  },
  tx: Parameters<DefinitionsRepository['replaceTargets']>[3],
): Promise<void> {
  await definitions.replaceTargets(id, 'process_type', bindings.processTypeIds, tx);
  await definitions.replaceTargets(id, 'project_type', bindings.projectTypeIds, tx);
  await definitions.replaceTargets(id, 'node_kind', bindings.nodeKindIds, tx);
}

/** Статическое умолчание проверяется тем же валидатором, что и значения:
 *  грамматика типа + существование/видимость ссылок. На создании это
 *  отдельный вызов — id определения ещё нет (#646). */
export async function assertDefaultUsable(
  validator: CustomFieldValueValidator,
  definitionId: string,
  type: CustomFieldDefinition['type'],
  settings: CustomFieldDefinition['settings'],
  defaultValue: CustomFieldDefinition['defaultValue'],
): Promise<void> {
  if (defaultValue?.kind !== 'static') return;
  const issues = await validator.validate([{ id: definitionId, type, settings }], {
    [definitionId]: defaultValue.value,
  });
  if (issues.length > 0) {
    throw new DomainException(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Default value is invalid', {
      issues,
    });
  }
}

/** Справочник списка и валюта денег обязаны существовать и быть активными. */
export async function assertSettingsUsable(
  dictionaries: DictionaryReader,
  type: string,
  dictionaryId: string | undefined,
  currencyId: string | null | undefined,
): Promise<void> {
  if ((type === 'enum' || type === 'multienum') && dictionaryId) {
    const [dictionary] = await dictionaries.dictionaryRefs([dictionaryId]);
    if (!dictionary) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Dictionary not found', {
        dictionaryId,
      });
    }
  }
  if (type === 'money' && currencyId) {
    const [item] = await dictionaries.itemRefs([currencyId]);
    const [dictionary] = item ? await dictionaries.dictionaryRefs([item.dictionaryId]) : [];
    if (!item?.isActive || dictionary?.code !== SystemDictionary.CURRENCY) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Currency not found', {
        currencyId,
      });
    }
  }
}

/**
 * Проверки правки определения до транзакции: белый список смены типа,
 * shape настроек, справочник/валюта, привязки (глобальной переменной —
 * нельзя), статическое умолчание — валидатором значений. Возвращает
 * следующие тип/настройки/умолчание для записи.
 */
export async function assertUpdateAllowed(
  ctx: {
    mapper: DefinitionMapper;
    validator: CustomFieldValueValidator;
    dictionaries: DictionaryReader;
    catalog: ProcessCatalogReader;
    targets: FieldBindingTargetReader;
  },
  id: string,
  current: FieldDefinitionRow,
  dto: UpdateCustomFieldBody,
): Promise<{
  nextType: CustomFieldDefinition['type'];
  nextSettings: CustomFieldDefinition['settings'];
  nextDefault: CustomFieldDefinition['defaultValue'];
}> {
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
  await assertSettingsUsable(
    ctx.dictionaries,
    nextType,
    nextSettings.dictionaryId,
    nextSettings.currencyId,
  );
  if (dto.bindings !== undefined) {
    if (current.isCompany) {
      throw new DomainException(
        ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
        'Company variable cannot have bindings',
        { reason: 'company' },
      );
    }
    // Архивный тип процесса, уже привязанный к атрибуту, не блокирует
    // сохранение полного набора: снять его можно, оставить — тоже (#646).
    const allowArchivedProcessTypeIds = new Set(
      current.bindings
        .filter((binding) => binding.targetKind === 'process_type')
        .map((binding) => binding.targetId),
    );
    await assertBindingsUsable(ctx.catalog, ctx.targets, dto.bindings, {
      allowArchivedProcessTypeIds,
    });
  }
  if (nextDefault?.kind === 'static') {
    const issues = await ctx.validator.validate(
      [{ ...(await ctx.mapper.toDto(current)), type: nextType, settings: nextSettings }],
      { [id]: nextDefault.value },
    );
    if (issues.length > 0) {
      throw new DomainException(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, 'Default value is invalid', {
        issues,
      });
    }
  }
  return { nextType, nextSettings, nextDefault };
}

/** 409 дубля имени: suggestion существующего — «открыть существующий» (В3). */
export function nameTaken(definitionId: string, name: string): DomainException {
  return new DomainException(ErrorCode.CUSTOM_FIELD_NAME_TAKEN, 'Field name is taken', {
    suggestion: { definitionId, name },
  });
}

/** Снятие привязки полным набором: слоты форм мест убираются синхронно
 *  (#646), чтобы required-слот удалённого/снятого атрибута не блокировал
 *  создание записи в окне outbox. */
export async function cleanRemovedFormSlots(
  formCleaner: FieldBindingFormCleaner,
  current: FieldDefinitionRow,
  next: CustomFieldBindings,
  actorId: string,
  tx: TransactionClient,
): Promise<void> {
  const removed = current.bindings.filter(
    (binding) =>
      (binding.targetKind === 'project_type' && !next.projectTypeIds.includes(binding.targetId)) ||
      (binding.targetKind === 'node_kind' && !next.nodeKindIds.includes(binding.targetId)),
  );
  for (const binding of removed) {
    await formCleaner.removeFieldFromForm(
      { kind: binding.targetKind as 'project_type' | 'node_kind', id: binding.targetId },
      current.id,
      actorId,
      tx,
    );
  }
}
