import type {
  ConditionPredicate,
  ConditionQuery,
  ConditionQuantifier,
  ConditionSubject,
  FormulaNode,
  GateOverridePolicy,
} from '@nodus/contracts';
import { CONDITION_LIMITS, DEFAULT_GATE_OVERRIDE } from '@nodus/contracts';

import type { Rules } from './transition-rules.js';

/**
 * Чистые правки правил общей выборки (#635, unified-model §7): условия
 * records/formula (прячут кнопку) и проверки records/formula (не пускают,
 * причина — подпись настройщика со ссылками на записи). Панель вызывает
 * эти функции и патчит `rules` целиком — как `transition-rules.ts`.
 */

/** Правила общей выборки у владельца кнопки (переход или действие). */
export function asyncRulesOf(rules: Rules) {
  return {
    conditions: rules.conditions.flatMap((c) =>
      c.kind === 'records' || c.kind === 'formula' ? [c] : [],
    ),
    validators: rules.validators.flatMap((v) =>
      v.kind === 'records' || v.kind === 'formula' ? [v] : [],
    ),
  };
}

export type RecordsCondition = Extract<Rules['conditions'][number], { kind: 'records' }>;
export type FormulaCondition = Extract<Rules['conditions'][number], { kind: 'formula' }>;
export type ConditionRule = RecordsCondition | FormulaCondition;
export type RecordsValidator = Extract<Rules['validators'][number], { kind: 'records' }>;
export type FormulaValidator = Extract<Rules['validators'][number], { kind: 'formula' }>;
export type CheckValidator = RecordsValidator | FormulaValidator;

/** Пустая выборка: эта запись, без условий, «все записи». */
export function emptyConditionQuery(): ConditionQuery {
  return { subject: { kind: 'self' }, where: [], quantifier: 'all' };
}

/** Заготовка проверки records: подпись начинается пустой — карточка и чип
 *  проблем требуют её заполнить (`condition_title_empty`). */
export function newRecordsValidator(): RecordsValidator {
  return {
    kind: 'records',
    title: '',
    query: emptyConditionQuery(),
    override: { ...DEFAULT_GATE_OVERRIDE },
  };
}

/** Проверка-формула появляется только с заданной формулой (диалог saving
 *  AST): «формула без формулы» в черновике не живёт. */
export function newFormulaValidator(formula: FormulaNode): FormulaValidator {
  return {
    kind: 'formula',
    title: '',
    formula,
    override: { ...DEFAULT_GATE_OVERRIDE },
  };
}

// --- Условия (прячут кнопку) ----------------------------------------------

/** Заменить условия records/formula целиком (порядок сохраняем). */
function setConditions(rules: Rules, next: readonly ConditionRule[]): Rules {
  const merged = [...rules.conditions.filter((c) => c.kind !== 'records' && c.kind !== 'formula')];
  // Новые виды — в конец: ролевые и решающие читаются первыми.
  return { ...rules, conditions: [...merged, ...next] };
}

export function addCondition(rules: Rules, rule: ConditionRule): Rules {
  return setConditions(rules, [...asyncRulesOf(rules).conditions, rule]);
}

export function updateConditionAt(rules: Rules, index: number, rule: ConditionRule): Rules {
  return setConditions(
    rules,
    asyncRulesOf(rules).conditions.map((current, i) => (i === index ? rule : current)),
  );
}

export function removeConditionAt(rules: Rules, index: number): Rules {
  return setConditions(
    rules,
    asyncRulesOf(rules).conditions.filter((_, i) => i !== index),
  );
}

// --- Проверки (не пускают) -------------------------------------------------

function setCheckValidators(rules: Rules, next: readonly CheckValidator[]): Rules {
  const merged = [...rules.validators.filter((v) => v.kind !== 'records' && v.kind !== 'formula')];
  return { ...rules, validators: [...merged, ...next] };
}

export function addValidator(rules: Rules, rule: CheckValidator): Rules {
  return setCheckValidators(rules, [...asyncRulesOf(rules).validators, rule]);
}

export function updateValidatorAt(rules: Rules, index: number, rule: CheckValidator): Rules {
  return setCheckValidators(
    rules,
    asyncRulesOf(rules).validators.map((current, i) => (i === index ? rule : current)),
  );
}

export function removeValidatorAt(rules: Rules, index: number): Rules {
  return setCheckValidators(
    rules,
    asyncRulesOf(rules).validators.filter((_, i) => i !== index),
  );
}

// --- Выборка: субъект / предикаты / квантор --------------------------------

export function withSubject(query: ConditionQuery, subject: ConditionSubject): ConditionQuery {
  return { ...query, subject };
}

export function setQuantifier(
  query: ConditionQuery,
  quantifier: ConditionQuantifier,
): ConditionQuery {
  return { ...query, quantifier };
}

/** Смена типа записи сбрасывает stage_is-предикаты чужого типа: статус
 *  выбирается по типу (публикация: stage_is требует type_is той же выборки). */
export function withPredicateAt(
  query: ConditionQuery,
  index: number,
  predicate: ConditionPredicate,
): ConditionQuery {
  const where = query.where.map((current, i) => (i === index ? predicate : current));
  return { ...query, where };
}

export function addPredicate(query: ConditionQuery, predicate: ConditionPredicate): ConditionQuery {
  if (query.where.length >= CONDITION_LIMITS.predicates) return query;
  return { ...query, where: [...query.where, predicate] };
}

export function removePredicateAt(query: ConditionQuery, index: number): ConditionQuery {
  return { ...query, where: query.where.filter((_, i) => i !== index) };
}

/** Смена атрибута предиката field: оператор обязан подходить типу атрибута
 *  (матрица CONDITION_FIELD_OPS_BY_TYPE — редактор и публикация едины). */
export function withFieldPredicate(
  predicate: Extract<ConditionPredicate, { kind: 'field' }>,
  patch: Partial<Omit<Extract<ConditionPredicate, { kind: 'field' }>, 'kind'>>,
): Extract<ConditionPredicate, { kind: 'field' }> {
  return { ...predicate, ...patch };
}

// --- Обход ------------------------------------------------------------------

export function withOverridePolicy<T extends { override: GateOverridePolicy }>(
  rule: T,
  patch: Partial<GateOverridePolicy>,
): T {
  return { ...rule, override: { ...rule.override, ...patch } };
}
