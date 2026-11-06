import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
} from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { DefinitionMapper } from '../definitions/definition.mapper.js';
import { DefinitionsRepository } from '../definitions/definitions.repository.js';
import { CustomFieldDefaults } from '../values/defaults.js';
import { CustomFieldRefsHydrator } from '../values/refs-hydrator.js';
import { CustomFieldValueValidator, type CustomFieldIssue } from '../values/value-validator.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import type {
  CustomFieldRegistry,
  PrepareCreateArgs,
  PrepareUpdateArgs,
  RegistryFieldChange,
  RegistryQuery,
  RegistryScoping,
  RegistryTarget,
} from './custom-field-registry.port.js';

/**
 * Реализация порта реестра атрибутов (#431, Р2; #631 — скопинг по месту):
 * единственная точка динамической валидации значений и умолчаний. Реестр
 * портала ≤ 1000 строк читается одним запросом без кэша.
 *
 * Каноническое сравнение значений — по стабильной строке: PostgreSQL
 * переставляет ключи JSONB, а `{amount, currencyId}` и `{currencyId, amount}`
 * — одно значение (gotcha «jsonb переставляет ключи»).
 */
@Injectable()
export class CustomFieldRegistryProvider implements CustomFieldRegistry {
  constructor(
    private readonly repository: DefinitionsRepository,
    private readonly mapper: DefinitionMapper,
    private readonly validator: CustomFieldValueValidator,
    private readonly defaults: CustomFieldDefaults,
    private readonly hydrator: CustomFieldRefsHydrator,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CustomFieldRegistryProvider.name);
  }

  async definitions(
    opts: RegistryQuery = {},
    tx?: TransactionClient,
  ): Promise<CustomFieldDefinition[]> {
    const all = await this.mapper.toDtos(await this.repository.list(tx), tx);
    return opts.target === undefined ? all : all.filter(boundTo(opts.target));
  }

  async prepareCreate(args: PrepareCreateArgs, tx?: TransactionClient): Promise<CustomFieldValues> {
    // Весь реестр — чтобы отличить «нет такого атрибута» от «есть, но не
    // привязан к месту» (Р8/Р3): второе — отдельная причина.
    const all = await this.definitions({}, tx);
    const definitions = boundList(all, args);
    const unbound = unboundIssues(all, definitions, args.input);
    if (unbound.length > 0) throw invalidValues(unbound);
    if (definitions.length === 0) {
      assertNoInput(args.input);
      return {};
    }

    const candidates = await this.defaults.resolve(definitions, args.authorId, tx);
    const defaultIssues = await this.validator.validate(definitions, candidates, tx);
    const cleanDefaults = dropIssues(candidates, defaultIssues);
    if (defaultIssues.length > 0) {
      this.logger.warn(
        { fieldIds: defaultIssues.map((issue) => issue.fieldId) },
        'Умолчания атрибутов пропущены: ссылки недействительны',
      );
    }

    const issues = await this.validator.validate(definitions, args.input, tx, args.actor);
    if (issues.length > 0) throw invalidValues(issues);
    return { ...cleanDefaults, ...args.input };
  }

  async prepareUpdate(
    args: PrepareUpdateArgs,
    tx?: TransactionClient,
  ): Promise<{ next: CustomFieldValues; changes: RegistryFieldChange[] }> {
    const changed: CustomFieldValues = {};
    for (const [fieldId, value] of Object.entries(args.patch)) {
      if (value === null) continue;
      if (canonical(args.current[fieldId]) !== canonical(value)) changed[fieldId] = value;
    }

    const all = await this.definitions({}, tx);
    const definitions = boundList(all, args);
    // Запись непривязанного — ошибка; очистка (`null`) разрешена всегда:
    // снятие привязки не должно блокировать уборку старого значения (Р8).
    const unbound = unboundIssues(all, definitions, changed);
    if (unbound.length > 0) throw invalidValues(unbound);
    const issues = await this.validator.validate(definitions, changed, tx, args.actor);
    if (issues.length > 0) throw invalidValues(issues);

    const next: CustomFieldValues = { ...args.current };
    const changes: RegistryFieldChange[] = [];
    for (const [fieldId, value] of Object.entries(args.patch)) {
      const before = (args.current[fieldId] ?? null) as CustomFieldValue | null;
      if (value === null) {
        if (before === null) continue;
        delete next[fieldId];
        changes.push({ fieldId, from: before, to: null });
        continue;
      }
      if (canonical(before) === canonical(value)) continue;
      next[fieldId] = value;
      changes.push({ fieldId, from: before, to: value });
    }
    return { next, changes };
  }

  async refs(
    values: CustomFieldValues,
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]> {
    return this.refsMany([values], actor, tx);
  }

  async refsMany(
    valuesList: readonly CustomFieldValues[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldRef[]> {
    if (valuesList.every((values) => Object.keys(values).length === 0)) return [];
    const definitions = await this.definitions({}, tx);
    return this.hydrator.hydrateMany(definitions, valuesList, actor, tx);
  }

  async syncPlaceBindings(
    target: RegistryTarget,
    fieldIds: readonly string[],
    removedFieldIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<void> {
    if (target.kind === 'process_type') {
      throw new Error('process_type has no form slots');
    }
    await this.repository.syncTargets(target.kind, target.id, fieldIds, removedFieldIds, tx);
  }
}

/** Привязано ли определение к месту (Р3): строка field_bindings. */
function boundTo(target: RegistryTarget): (definition: CustomFieldDefinition) => boolean {
  return (definition) => {
    switch (target.kind) {
      case 'process_type':
        return definition.bindings.processTypeIds.includes(target.id);
      case 'project_type':
        return definition.bindings.projectTypeIds.includes(target.id);
      case 'node_kind':
        return definition.bindings.nodeKindIds.includes(target.id);
    }
  };
}

/** Атрибуты выбранного места; без `target` — весь реестр (фильтры, окна). */
function boundList(
  definitions: readonly CustomFieldDefinition[],
  scoping: RegistryScoping,
): CustomFieldDefinition[] {
  return scoping.target === undefined
    ? [...definitions]
    : definitions.filter(boundTo(scoping.target));
}

/** Значения СУЩЕСТВУЮЩИХ, но непривязанных к месту атрибутов — 422
 *  `not_in_type` (Р8, Р3). Неизвестный ключ сюда не попадает: его причина —
 *  `unknown`, иначе клиент не отличит опечатку в id от «атрибут есть, но не
 *  для этого места». */
function unboundIssues(
  all: readonly CustomFieldDefinition[],
  bound: readonly CustomFieldDefinition[],
  values: Readonly<Record<string, unknown>>,
): CustomFieldIssue[] {
  const boundIds = new Set(bound.map((definition) => definition.id));
  const knownIds = new Set(all.map((definition) => definition.id));
  return Object.entries(values)
    .filter(
      ([fieldId, value]) =>
        value !== null && value !== undefined && knownIds.has(fieldId) && !boundIds.has(fieldId),
    )
    .map(([fieldId]) => ({
      fieldId,
      reason: 'not_in_type' as const,
      message: 'Field is not bound to this place',
    }));
}

/** Пустой ввод при отсутствии определений — это «чужой ключ». */
function assertNoInput(input: CustomFieldValues): void {
  const keys = Object.keys(input);
  if (keys.length === 0) return;
  throw invalidValues(
    keys.map((fieldId) => ({
      fieldId,
      reason: 'unknown' as const,
      message: 'Unknown custom field',
    })),
  );
}

/** Значения без полей, отвергнутых валидатором (умолчания). */
function dropIssues(
  values: CustomFieldValues,
  issues: readonly CustomFieldIssue[],
): CustomFieldValues {
  if (issues.length === 0) return values;
  const rejected = new Set(issues.map((issue) => issue.fieldId));
  return Object.fromEntries(Object.entries(values).filter(([fieldId]) => !rejected.has(fieldId)));
}

/** 422 с перечнем полей (Р2): `details.issues[] = {fieldId, reason, message}`. */
export function invalidValues(issues: readonly CustomFieldIssue[]): DomainException {
  return new DomainException(
    ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
    'Custom field value is invalid',
    { issues },
  );
}

/** Стабильная строка значения: ключи объектов сортируются. */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${key}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
