import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import type {
  CustomFieldDefinition,
  CustomFieldType,
} from '../custom-fields/custom-field.schemas.js';
import type { ConditionFieldOp, ConditionQuery } from './condition-query.js';
import { CONDITION_SUBJECTS_BY_CATEGORY } from './condition-query.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';
import type { WorkflowCheckOptions } from './workflow-document-check.js';
import type {
  WorkflowCondition,
  WorkflowTransitionRules,
  WorkflowValidator,
} from './workflow.schemas.js';

/**
 * Проверки общей выборки #635 в документе маршрута (unified-model §7):
 * субъекты вне категории, ссылки на удалённые типы/статусы/виды папок и
 * атрибуты, несовместимость оператора с типом поля — ошибки; выборка по
 * большому множеству без фильтра — предупреждение. Чистая функция (работает
 * и в редакторе, и на публикации); факты (живые типы/стадии/виды) собирает
 * сервер — без фактов проверки пропускаются.
 */

/** Совместимость оператора с типом атрибута (#635): матрица редактора и
 *  публикации — один источник, иначе редактор предложит непубликуемое. */
export const CONDITION_FIELD_OPS_BY_TYPE: Readonly<
  Record<CustomFieldType, readonly ConditionFieldOp[]>
> = {
  text: ['eq', 'ne', 'contains', 'not_contains', 'filled', 'not_filled'],
  long_text: ['eq', 'ne', 'contains', 'not_contains', 'filled', 'not_filled'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'filled', 'not_filled'],
  money: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'filled', 'not_filled'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'filled', 'not_filled'],
  datetime: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'filled', 'not_filled'],
  duration: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'filled', 'not_filled'],
  bool: ['eq', 'ne', 'filled', 'not_filled'],
  enum: ['eq', 'ne', 'in_any', 'filled', 'not_filled'],
  multienum: ['eq', 'ne', 'in_any', 'filled', 'not_filled'],
  user: ['eq', 'ne', 'in_any', 'filled', 'not_filled'],
  users: ['eq', 'ne', 'in_any', 'filled', 'not_filled'],
  department: ['eq', 'ne', 'filled', 'not_filled'],
  project: ['eq', 'ne', 'filled', 'not_filled'],
  counterparty: ['eq', 'ne', 'filled', 'not_filled'],
  task: ['eq', 'ne', 'filled', 'not_filled'],
  letter: ['eq', 'ne', 'filled', 'not_filled'],
  node: ['eq', 'ne', 'filled', 'not_filled'],
  link: ['eq', 'ne', 'contains', 'not_contains', 'filled', 'not_filled'],
  counter: ['eq', 'ne', 'contains', 'not_contains', 'filled', 'not_filled'],
};

/** Субъекты «большое множество без фильтра типа» (#635, п.8): без предиката
 *  типа/поля проверка молотит все записи проекта — предупреждение. */
const UNFILTERED_SUBJECTS = new Set(['project_tasks', 'folder_type_tasks']);

/** Типы атрибутов-ссылок (ref_field, #635): только они дают записи движка.
 *  Сотрудник/подразделение/контрагент/перечисление — не записи: вычисление
 *  такого субъекта всегда пусто, публикация rejects (проверка-пустышка). */
const CONDITION_REF_FIELD_TYPES = new Set<CustomFieldType>(['task', 'letter', 'project', 'node']);

type ConditionRules = Pick<WorkflowTransitionRules, 'conditions' | 'validators'>;
type OwnerRef = Pick<WorkflowProblem, 'transitionId' | 'actionId'>;

/** Есть ли в документе правила общей выборки или формулы (#635): редактор и
 *  публикация по этому флагу собирают факты (типы, стадии, виды папок). */
export function hasConditionRules(doc: WorkflowDraftDocument): boolean {
  const owners: readonly ConditionRules[] = [
    ...doc.transitions.map((t) => t.rules),
    ...(doc.actions ?? []).map((a) => a.rules),
  ];
  return owners.some(hasAsyncRules);
}

/** Формулы-условия/проверки (#635): АСТ проверяет движок на сервере. */
export function hasConditionFormulas(doc: WorkflowDraftDocument): boolean {
  const owners: readonly ConditionRules[] = [
    ...doc.transitions.map((t) => t.rules),
    ...(doc.actions ?? []).map((a) => a.rules),
  ];
  return owners.some(
    (rules) =>
      rules.conditions.some((c) => c.kind === 'formula') ||
      rules.validators.some((v) => v.kind === 'formula'),
  );
}

/** Условия/проверки records/formula у владельца кнопки. */
export function asyncRulesOf(rules: ConditionRules): {
  conditions: Extract<WorkflowCondition, { kind: 'records' | 'formula' }>[];
  validators: Extract<WorkflowValidator, { kind: 'records' | 'formula' }>[];
} {
  return {
    conditions: rules.conditions.filter(
      (c): c is Extract<WorkflowCondition, { kind: 'records' | 'formula' }> =>
        c.kind === 'records' || c.kind === 'formula',
    ),
    validators: rules.validators.filter(
      (v): v is Extract<WorkflowValidator, { kind: 'records' | 'formula' }> =>
        v.kind === 'records' || v.kind === 'formula',
    ),
  };
}

function hasAsyncRules(rules: ConditionRules): boolean {
  const { conditions, validators } = asyncRulesOf(rules);
  return conditions.length > 0 || validators.length > 0;
}

export function checkConditionRules(
  doc: WorkflowDraftDocument,
  opts: WorkflowCheckOptions,
  problems: WorkflowProblem[],
): void {
  if (!opts.category) return;
  const definitionsById = new Map(
    (opts.definitions ?? []).map((definition) => [definition.id, definition]),
  );
  for (const t of doc.transitions) {
    checkOwner(t.rules, { transitionId: t.id }, opts, definitionsById, problems);
  }
  for (const a of doc.actions ?? []) {
    checkOwner(a.rules, { actionId: a.id }, opts, definitionsById, problems);
  }
}

function checkOwner(
  rules: ConditionRules,
  refs: OwnerRef,
  opts: WorkflowCheckOptions,
  definitionsById: Map<string, Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>>,
  problems: WorkflowProblem[],
): void {
  const { conditions, validators } = asyncRulesOf(rules);
  const queries: ConditionQuery[] = [
    ...[...conditions, ...validators]
      .filter((rule): rule is Extract<typeof rule, { kind: 'records' }> => rule.kind === 'records')
      .map((rule) => rule.query),
  ];
  for (const query of queries) {
    checkQuery(query, refs, opts, definitionsById, problems);
  }
  // Черновик конструктора: проверка без подписи (сотрудник не узнает причину)
  // или формула без формулы — схема документа их отвергнет, называем заранее.
  // Тип формулы в схеме ненулевой: черновик редактора проходит сюда до
  // валидации, поэтому сравнение с null — сознательное (runtime-страховка).
  for (const validator of validators) {
    if (!validator.title.trim()) {
      problems.push({ code: 'condition_title_empty', severity: 'error', ...refs });
    }
    if (validator.kind === 'formula' && (validator.formula as unknown as object | null) === null) {
      problems.push({ code: 'condition_formula_missing', severity: 'error', ...refs });
    }
  }
}

function checkQuery(
  query: ConditionQuery,
  refs: OwnerRef,
  opts: WorkflowCheckOptions,
  definitionsById: Map<string, Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>>,
  problems: WorkflowProblem[],
): void {
  const category = opts.category!;
  const allowedSubjects: readonly string[] = CONDITION_SUBJECTS_BY_CATEGORY[category];
  if (!allowedSubjects.includes(query.subject.kind)) {
    problems.push({ code: 'condition_subject_not_in_category', severity: 'error', ...refs });
  }
  // Вид папки (project_folders/folder_type_tasks): удалённый/архивный — ошибка.
  if (
    (query.subject.kind === 'project_folders' || query.subject.kind === 'folder_type_tasks') &&
    query.subject.folderTypeId !== undefined &&
    opts.conditionNodeKindFacts &&
    !opts.conditionNodeKindFacts.has(query.subject.folderTypeId)
  ) {
    problems.push({ code: 'condition_folder_type_unknown', severity: 'error', ...refs });
  }
  // Поле-ссылка (ref_field): атрибут хоста — существует и привязан к типу
  // маршрута (механизм checkKey: unknown/not_in_type); тип атрибута обязан
  // быть ссылкой на запись движка — сотрудник/подразделение/контрагент и
  // прочие не-ссылки дают всегда пустую выборку (проверка-пустышка).
  if (query.subject.kind === 'ref_field') {
    checkFieldKey(query.subject.field, refs, opts, true, definitionsById, problems);
    const fieldId = customFieldIdOfKey(query.subject.field);
    const definition = fieldId !== null ? definitionsById.get(fieldId) : undefined;
    if (definition && !CONDITION_REF_FIELD_TYPES.has(definition.type)) {
      problems.push({ code: 'condition_ref_field_not_link', severity: 'error', ...refs });
    }
  }
  const typeIs = query.where.filter(
    (p): p is Extract<typeof p, { kind: 'type_is' }> => p.kind === 'type_is',
  );
  for (const predicate of typeIs) {
    if (opts.conditionTypeFacts && !opts.conditionTypeFacts.has(predicate.typeId)) {
      problems.push({ code: 'condition_type_unknown', severity: 'error', ...refs });
    }
  }
  for (const predicate of query.where) {
    if (predicate.kind === 'stage_is') {
      if (typeIs.length === 0) {
        problems.push({ code: 'condition_stage_without_type', severity: 'error', ...refs });
        continue;
      }
      if (opts.conditionStageFacts) {
        const known = typeIs.some((t) =>
          opts.conditionStageFacts?.get(t.typeId)?.has(predicate.stageId),
        );
        if (!known) {
          problems.push({ code: 'condition_stage_unknown', severity: 'error', ...refs });
        }
      }
      continue;
    }
    if (predicate.kind === 'field') {
      checkFieldKey(predicate.field, refs, opts, false, definitionsById, problems);
      const fieldId = customFieldIdOfKey(predicate.field);
      const definition = fieldId !== null ? definitionsById.get(fieldId) : undefined;
      if (definition && !CONDITION_FIELD_OPS_BY_TYPE[definition.type].includes(predicate.op)) {
        problems.push({ code: 'condition_field_op_incompatible', severity: 'error', ...refs });
      }
    }
  }
  // Большое множество без фильтра (тип или поле) — предупреждение (#635, п.8).
  const filtered = typeIs.length > 0 || query.where.some((p) => p.kind === 'field');
  if (UNFILTERED_SUBJECTS.has(query.subject.kind) && !filtered) {
    problems.push({ code: 'condition_query_unfiltered', severity: 'warning', ...refs });
  }
}

/** Ключ атрибута выборки: у ref_field (поле хоста) — привязка к типу
 *  обязательна; у предиката field (поле записей выборки) — только
 *  существование: поле чужого типа здесь законно (свои записи отбирает
 *  предикат type_is). */
function checkFieldKey(
  key: string,
  refs: OwnerRef,
  opts: WorkflowCheckOptions,
  requireInType: boolean,
  definitionsById: Map<string, Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>>,
  problems: WorkflowProblem[],
): void {
  const id = customFieldIdOfKey(key);
  if (id === null) return;
  const fields = opts.customFields;
  if (fields) {
    if (!fields.active.has(id)) {
      problems.push({ code: 'custom_field_unknown', severity: 'error', ...refs });
      return;
    }
    if (requireInType && fields.inType && !fields.inType.has(id)) {
      problems.push({ code: 'custom_field_not_in_type', severity: 'error', ...refs });
    }
    return;
  }
  // Без фактов customFields — толерантно: хотя бы определение известно.
  if (definitionsById.size > 0 && !definitionsById.has(id)) {
    problems.push({ code: 'custom_field_unknown', severity: 'error', ...refs });
  }
}
