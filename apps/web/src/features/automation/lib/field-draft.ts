import type {
  FormulaNode,
  NumberSeriesRule,
  CustomFieldBindings,
  CustomFieldDefault,
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldSettings,
  CustomFieldType,
  CustomFieldValue,
  DictionaryItem,
  StageColor,
} from '@nodus/contracts';
import { EMPTY_CUSTOM_FIELD_BINDINGS, numberSeriesRuleSchema } from '@nodus/contracts';

import {
  baseTypeOf,
  familyModifier,
  familyOf,
  modifierOf,
  typeWithModifier,
  type FieldFamily,
} from './field-type-families.js';
import { DEFAULT_COUNTER_RULE } from './counter-rule.js';
import { triggerProblems, unreachableBindings, type BindingHostKindOf } from './counter-draft.js';

export type { BindingHostKindOf } from './counter-draft.js';
export { onCreateOf, triggerProblems, unreachableBindings } from './counter-draft.js';

/**
 * Черновик окна атрибута (#431, ревизия #631): окно правит черновик, сервер
 * получает изменения только по «Создать»/«Сохранить». Здесь — чистые
 * функции: начальный черновик, тип из семейства и модификатора, тела API,
 * проверка. Умолчание списка — отметка на варианте (модель Битрикс24 «По
 * умолч.»), для остальных типов — значение редактором карточки.
 * Привязки «Где используется» и вид «Атрибут записей / Глобальная
 * переменная» — часть черновика (Р3/Р7).
 */

/** Вариант списка в черновике: id сервера или временный (`draft:`);
 *  удалённый вариант просто исчезает из массива. `color` — тон палитры
 *  темы (Р6 #631): при создании не назначается, задаётся редактором. */
export interface OptionDraft {
  id: string;
  name: string;
  color: StageColor | null;
}

export const DRAFT_PREFIX = 'draft:';

export type DefaultMode = 'none' | 'static' | 'author_department';

export interface FieldDraft {
  family: FieldFamily | null;
  /** Модификатор семейства включён: многострочный / несколько значений. */
  modifier: boolean;
  name: string;
  hint: string;
  settings: Pick<CustomFieldSettings, 'precision' | 'currencyId'>;
  /** Режим умолчания не-списка: «Значение» без выбранного значения — ещё
   *  не умолчание (сохранится как «нет»). */
  defaultMode: DefaultMode;
  /** Умолчание не-списка (у списка — `defaultOptionIds`). */
  defaultValue: CustomFieldDefault | null;
  /** Ссылки выбранного умолчания (имя сотрудника и т.п. до ответа сервера). */
  defaultRefs: CustomFieldRef[];
  options: OptionDraft[];
  defaultOptionIds: string[];
  /** Глобальная переменная (Р7): привязок нет, значение одно на компанию. */
  isCompany: boolean;
  /** Значение глобальной переменной (грамматика типа); null — не задано. */
  companyValue: CustomFieldValue | null;
  /** Ссылки выбранного значения глобальной — имена до ответа сервера
   *  (иначе редактор показывает «Запись недоступна», #646). */
  companyRefs: CustomFieldRef[];
  reportIndexed: boolean;
  /** «Где используется» (Р3): типы задач/писем, типы проектов, виды папок. */
  bindings: CustomFieldBindings;
  /** Формулы типа/вида по привязкам (#632): id цели → AST. */
  bindingFormulas: Record<string, FormulaNode>;
  /** Правило счётчика (#630): живёт в черновике всегда, отправляется только
   *  при family='counter'. */
  numbering: NumberSeriesRule;
  /** Цели привязок, получающие номер «при создании» (модель v3: когда
   *  выдаётся — у каждого типа свой способ). */
  numberingOnCreate: string[];
  /** «Следующий номер» сквозного счёта при создании (без условий «отдельно
   *  для»); null — с начала («Каждый новый счёт начинается с»). */
  numberingNext: number | null;
}

export const emptyDraft: FieldDraft = {
  family: null,
  modifier: false,
  name: '',
  hint: '',
  settings: {},
  defaultMode: 'none',
  defaultValue: null,
  defaultRefs: [],
  options: [],
  defaultOptionIds: [],
  isCompany: false,
  companyValue: null,
  companyRefs: [],
  reportIndexed: false,
  bindings: EMPTY_CUSTOM_FIELD_BINDINGS,
  bindingFormulas: {},
  numbering: DEFAULT_COUNTER_RULE,
  numberingOnCreate: [],
  numberingNext: null,
};

export function isListFamily(family: FieldFamily | null): boolean {
  return family === 'list';
}

export function draftType(draft: FieldDraft): CustomFieldType | null {
  if (!draft.family) return null;
  const modifier = familyModifier(draft.family);
  return draft.modifier && modifier
    ? typeWithModifier(draft.family, modifier)
    : baseTypeOf(draft.family);
}

/** Черновик из сохранённого атрибута; варианты — из справочника поля. */
export function draftOf(
  definition: CustomFieldDefinition,
  items: readonly DictionaryItem[],
): FieldDraft {
  const family = familyOf(definition.type);
  const list = isListFamily(family);
  const value = definition.defaultValue?.kind === 'static' ? definition.defaultValue.value : null;
  return {
    family,
    modifier: modifierOf(definition.type) !== null,
    name: definition.name,
    hint: definition.hint ?? '',
    settings: {
      ...(definition.settings.precision !== undefined
        ? { precision: definition.settings.precision }
        : {}),
      ...(definition.settings.currencyId !== undefined
        ? { currencyId: definition.settings.currencyId }
        : {}),
    },
    defaultMode: list ? 'none' : (definition.defaultValue?.kind ?? 'none'),
    defaultValue: list ? null : definition.defaultValue,
    defaultRefs: definition.defaultRefs,
    options: items.map((item) => ({ id: item.id, name: item.name, color: item.color })),
    defaultOptionIds: !list
      ? []
      : Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string')
        : typeof value === 'string'
          ? [value]
          : [],
    isCompany: definition.isCompany,
    companyValue: definition.companyValue,
    companyRefs: [...(definition.companyRefs ?? [])],
    reportIndexed: definition.reportIndexed,
    bindings: {
      processTypeIds: [...definition.bindings.processTypeIds],
      projectTypeIds: [...definition.bindings.projectTypeIds],
      nodeKindIds: [...definition.bindings.nodeKindIds],
    },
    bindingFormulas: definition.type === 'counter' ? {} : { ...(definition.bindingFormulas ?? {}) },
    numbering: definition.numbering?.rule ?? DEFAULT_COUNTER_RULE,
    numberingOnCreate: [...(definition.numbering?.onCreate ?? [])],
    numberingNext: null,
  };
}

/** Смена семейства в окне создания: настройки и умолчание прежнего типа
 *  не переносятся (у «Числа» нет валюты, у «Текста» — вариантов). */
export function withFamily(draft: FieldDraft, family: FieldFamily): FieldDraft {
  if (draft.family === family) return draft;
  return {
    ...draft,
    family,
    modifier: false,
    settings: family === 'number' ? { precision: 0 } : {},
    defaultMode: 'none',
    defaultValue: null,
    defaultRefs: [],
    defaultOptionIds: [],
    options: family === 'list' ? draft.options : [],
    bindingFormulas: family === 'counter' ? {} : draft.bindingFormulas,
    numbering: family === 'counter' ? draft.numbering : DEFAULT_COUNTER_RULE,
    numberingOnCreate: family === 'counter' ? draft.numberingOnCreate : [],
  };
}

/** Временное определение для редактора умолчания и глобального значения
 *  (та же грамматика, что в карточке). */
export function draftDefinition(
  draft: FieldDraft,
  currencyFallback: string | null,
): CustomFieldDefinition | null {
  const type = draftType(draft);
  if (!type) return null;
  const now = new Date(0).toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000000',
    number: 0,
    type,
    name: draft.name || '—',
    hint: null,
    settings:
      type === 'money'
        ? { currencyId: draft.settings.currencyId ?? currencyFallback }
        : type === 'number'
          ? { precision: draft.settings.precision ?? 0 }
          : {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: EMPTY_CUSTOM_FIELD_BINDINGS,
    bindingFormulas: draft.bindingFormulas,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export type DraftIssue =
  | 'name'
  | 'family'
  | 'options'
  | 'optionsDuplicate'
  | 'numbering'
  | 'numberingUnreachable'
  | 'numberingTrigger';

/** Что мешает сохранить (кнопка неактивна, подсказка у поля). */
export function draftIssues(draft: FieldDraft, hostKindOf?: BindingHostKindOf): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (draft.name.trim().length === 0) issues.push('name');
  if (!draft.family) issues.push('family');
  if (isListFamily(draft.family)) {
    const names = draft.options.map((option) => option.name.trim().toLowerCase());
    if (names.length === 0 || names.some((name) => name.length === 0)) issues.push('options');
    if (new Set(names).size !== names.length) issues.push('optionsDuplicate');
  }
  if (draft.family === 'counter' && !draft.isCompany) {
    // Ровно один «Номер» и совместимость привязок с контейнером (#630):
    // строки ошибок рисует секция «Счётчик» и «Кто получает номер».
    if (!numberSeriesRuleSchema.safeParse(draft.numbering).success) issues.push('numbering');
    if (hostKindOf && unreachableBindings(draft, hostKindOf).length > 0)
      issues.push('numberingUnreachable');
    if (hostKindOf && triggerProblems(draft, hostKindOf).length > 0)
      issues.push('numberingTrigger');
  }
  return issues;
}

/** Свежие ссылки значения глобальной поверх прежних (ключ `kind:id`):
 *  выбранная запись должна показывать имя сразу, до ответа сервера (#646). */
export function mergeDraftRefs(
  base: readonly CustomFieldRef[],
  picked?: readonly CustomFieldRef[],
): CustomFieldRef[] {
  const merged = new Map(base.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
  for (const ref of picked ?? []) merged.set(`${ref.kind}:${ref.id}`, ref);
  return [...merged.values()];
}

/** Изменилось ли значение глобальной переменной (отдельный PUT, Р7). */
export function companyValueChanged(definition: CustomFieldDefinition, draft: FieldDraft): boolean {
  return JSON.stringify(draft.companyValue) !== JSON.stringify(definition.companyValue);
}
