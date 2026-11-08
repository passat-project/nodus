import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldType,
  CustomFieldValue,
  FormulaNode,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import { CounterSummaryService } from '../numbering/counter-summary.provider.js';
import { CustomFieldRefsHydrator } from '../values/refs-hydrator.js';

/** Строка `field_definitions` в объёме DTO (схема — ADR-0029, ревизия #631). */
export interface FieldDefinitionRow {
  id: string;
  number: number;
  type: string;
  name: string;
  hint: string | null;
  settings: unknown;
  defaultValue: unknown;
  reportIndexed: boolean;
  isCompany: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  /** Привязки «Где используется» (Р3); глобальная переменная — пусто.
   *  `defaultFormula` — формула места (#632, Р6), вычисляется на чтении;
   *  `numberOnCreate` — тип получает номер при создании (#630). */
  bindings: {
    targetKind: string;
    targetId: string;
    defaultFormula?: unknown;
    numberOnCreate?: boolean;
  }[];
  /** Серия нумерации counter-атрибута (#630): правило 1:1. */
  numberSeriesId?: string | null;
  /** Значение глобальной переменной (null — не задано). */
  companyValue: { value: unknown } | null;
}

/**
 * Строка определения → DTO контракта (#631): настройки типа, справочник
 * списка и ссылки статического умолчания (имена для колонки «По умолчанию»),
 * привязки по видам целей и значение глобальной переменной. Пачки: один
 * запрос справочников и один гидратор ссылок на список, а не на строку —
 * реестр портала ≤ 1000.
 */
@Injectable()
export class DefinitionMapper {
  constructor(
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
    private readonly refs: CustomFieldRefsHydrator,
    private readonly counters: CounterSummaryService,
  ) {}

  async toDtos(
    rows: readonly FieldDefinitionRow[],
    tx?: TransactionClient,
    actor?: ProjectActor,
  ): Promise<CustomFieldDefinition[]> {
    if (rows.length === 0) return [];
    const definitions = rows.map((row) => this.base(row));

    const dictionaryIds = [
      ...new Set(
        definitions
          .filter((definition) => definition.type === 'enum' || definition.type === 'multienum')
          .map((definition) => definition.settings.dictionaryId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const dictionaries = await this.dictionaries.dictionaryRefs(dictionaryIds, tx);
    const dictionaryById = new Map(dictionaries.map((row) => [row.id, row]));

    const staticDefaults: Record<string, CustomFieldValue> = {};
    const companyValues: Record<string, CustomFieldValue> = {};
    for (const definition of definitions) {
      if (definition.defaultValue?.kind === 'static') {
        staticDefaults[definition.id] = definition.defaultValue.value;
      }
      if (definition.isCompany && definition.companyValue !== null) {
        companyValues[definition.id] = definition.companyValue;
      }
    }
    // Имена ссылок умолчаний и глобальных значений гидрируются отдельно:
    // у глобальной ссылки видимость — глазами актёра запроса (реестр читают
    // все), у умолчания актёра нет (ссылки-записи в умолчаниях запрещены).
    const [defaultRefs, companyRefs] = await Promise.all([
      this.refs.hydrate(
        rows.map((row) => this.base(row)),
        staticDefaults,
        undefined,
        tx,
      ),
      this.refs.hydrate(
        rows.map((row) => this.base(row)),
        companyValues,
        actor,
        tx,
      ),
    ]);
    const refsByKey = new Map(defaultRefs.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
    const companyRefsByKey = new Map(companyRefs.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
    // Счётчики (#630): правило, «при создании», пример, выдачи — один ответ
    // карточке; у остальных типов numbering = null.
    const counters = await this.counters.summaries(rows, tx);

    return definitions.map((definition) => {
      const dictionaryId =
        definition.type === 'enum' || definition.type === 'multienum'
          ? definition.settings.dictionaryId
          : undefined;
      const dictionary = dictionaryId ? dictionaryById.get(dictionaryId) : undefined;
      return {
        ...definition,
        numbering: definition.type === 'counter' ? (counters.get(definition.id) ?? null) : null,
        dictionary: dictionary
          ? {
              id: dictionary.id,
              code: dictionary.code,
              name: dictionary.name,
              isSystem: dictionary.isSystem,
            }
          : null,
        defaultRefs: refsOfDefault(definition, refsByKey),
        companyRefs: refsOfValue(definition.type, definition.companyValue, companyRefsByKey),
      };
    });
  }

  async toDto(
    row: FieldDefinitionRow,
    tx?: TransactionClient,
    actor?: ProjectActor,
  ): Promise<CustomFieldDefinition> {
    const [dto] = await this.toDtos([row], tx, actor);
    return dto!;
  }

  /** Поля DTO без справочника и ссылок умолчания (они собираются пачкой). */
  private base(row: FieldDefinitionRow): Omit<CustomFieldDefinition, 'dictionary' | 'defaultRefs'> {
    return {
      id: row.id,
      number: row.number,
      type: row.type as CustomFieldDefinition['type'],
      name: row.name,
      hint: row.hint,
      settings: (row.settings ?? {}) as CustomFieldDefinition['settings'],
      defaultValue: (row.defaultValue ?? null) as CustomFieldDefinition['defaultValue'],
      reportIndexed: row.reportIndexed,
      isCompany: row.isCompany,
      companyValue: (row.companyValue?.value ?? null) as CustomFieldDefinition['companyValue'],
      // Привязки по видам целей; порядок детерминирован — id по возрастанию.
      bindings: bindingsOf(row),
      // Формулы мест (#632, Р6): у каждой привязки своя; пусто — нет формул.
      bindingFormulas: bindingFormulasOf(row),
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Привязки строки → DTO (глобальная переменная связей не имеет). */
export function bindingsOf(row: Pick<FieldDefinitionRow, 'bindings'>): CustomFieldBindings {
  const processTypeIds: string[] = [];
  const projectTypeIds: string[] = [];
  const nodeKindIds: string[] = [];
  for (const binding of row.bindings) {
    if (binding.targetKind === 'process_type') processTypeIds.push(binding.targetId);
    else if (binding.targetKind === 'project_type') projectTypeIds.push(binding.targetId);
    else if (binding.targetKind === 'node_kind') nodeKindIds.push(binding.targetId);
  }
  return {
    processTypeIds: processTypeIds.sort(),
    projectTypeIds: projectTypeIds.sort(),
    nodeKindIds: nodeKindIds.sort(),
  };
}

/** Формулы мест (#632, Р6): targetId → AST. Пусто — у привязок формул нет. */
export function bindingFormulasOf(
  row: Pick<FieldDefinitionRow, 'bindings'>,
): Record<string, FormulaNode> | undefined {
  const entries = row.bindings
    .filter((binding) => binding.defaultFormula !== null && binding.defaultFormula !== undefined)
    .map((binding) => [binding.targetId, binding.defaultFormula as FormulaNode] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Ссылки, на которые указывает статическое умолчание определения. */
function refsOfDefault(
  definition: Omit<CustomFieldDefinition, 'dictionary' | 'defaultRefs' | 'companyRefs'>,
  refsByKey: ReadonlyMap<string, CustomFieldRef>,
): CustomFieldRef[] {
  if (definition.defaultValue?.kind !== 'static') return [];
  return refsOfValue(definition.type, definition.defaultValue.value, refsByKey);
}

/** Ссылки значения (умолчание или глобальная переменная) по карте имён. */
function refsOfValue(
  type: CustomFieldType,
  value: unknown,
  refsByKey: ReadonlyMap<string, CustomFieldRef>,
): CustomFieldRef[] {
  if (value === null || value === undefined) return [];
  const ids: string[] = [];
  switch (type) {
    case 'user':
    case 'users':
    case 'enum':
    case 'multienum':
      ids.push(...(Array.isArray(value) ? (value as string[]) : [String(value)]));
      break;
    case 'department':
    case 'counterparty':
    case 'project':
    case 'task':
    case 'letter':
    case 'node':
      ids.push(String(value));
      break;
    case 'money':
      ids.push((value as { currencyId: string }).currencyId);
      break;
    default:
      break;
  }
  const kinds: Partial<Record<CustomFieldType, CustomFieldRef['kind']>> = {
    user: 'user',
    users: 'user',
    department: 'department',
    enum: 'dictionary_item',
    multienum: 'dictionary_item',
    money: 'dictionary_item',
    counterparty: 'counterparty',
    project: 'project',
    task: 'task',
    letter: 'letter',
    node: 'node',
  };
  const kind = kinds[type];
  if (!kind) return [];
  return ids
    .map((id) => refsByKey.get(`${kind}:${id}`))
    .filter((ref): ref is CustomFieldRef => ref !== undefined);
}
