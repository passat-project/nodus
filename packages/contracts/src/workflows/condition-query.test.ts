import { describe, expect, it } from 'vitest';

import {
  CONDITION_LIMITS,
  CONDITION_SUBJECTS_BY_CATEGORY,
  conditionQuerySchema,
  conditionSubjectSchema,
  DEFAULT_GATE_OVERRIDE,
  gateOverridePolicySchema,
} from './condition-query.js';
import {
  workflowTransitionRulesSchema,
  workflowValidatorDtoSchema,
  workflowValidatorSchema,
} from './workflow.schemas.js';
import { formulaNodeSchema } from '../custom-fields/formula.js';

const TYPE = '11111111-1111-4111-8111-111111111111';
const STAGE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const FIELD = '44444444-4444-4444-8444-444444444444';

/** Булева формула-константа для проверок kind=formula. */
const formula = { kind: 'literal', value: true } as unknown as ReturnType<
  typeof formulaNodeSchema.parse
>;

describe('conditionQuery (#635: одна выборка на всё)', () => {
  it('субъекты: вся карта категорий покрывает каждый вид субъекта', () => {
    const declared = new Set<string>([
      ...CONDITION_SUBJECTS_BY_CATEGORY.task,
      ...CONDITION_SUBJECTS_BY_CATEGORY.letter,
    ]);
    for (const kind of conditionSubjectSchema.options.map((o) => o.shape.kind.value)) {
      expect(declared.has(kind), `субъект ${kind} не заявлен ни в одной категории`).toBe(true);
    }
  });

  it('субъекты: у письма нет задачных множеств (подзадачи, папки, связи)', () => {
    expect(CONDITION_SUBJECTS_BY_CATEGORY.letter).not.toContain('subtasks');
    expect(CONDITION_SUBJECTS_BY_CATEGORY.letter).not.toContain('folder_tasks');
    // Связи — только у задач: рантайм для писем всегда пуст (проверка-
    // пустышка), редактор не предлагает, публикация отвергает.
    expect(CONDITION_SUBJECTS_BY_CATEGORY.letter).not.toContain('relations');
  });

  it('выборка читается целиком; where по умолчанию пуст', () => {
    const q = conditionQuerySchema.parse({
      subject: { kind: 'subtasks' },
      where: [{ kind: 'type_is', typeId: TYPE }],
      quantifier: 'all',
    });
    expect(q.where).toHaveLength(1);
    expect(
      conditionQuerySchema.parse({ subject: { kind: 'project' }, quantifier: 'none' }).where,
    ).toEqual([]);
  });

  it('предикаты: поле со значением и без, статус, итог, «результат выдан»', () => {
    expect(
      conditionQuerySchema.parse({
        subject: { kind: 'relations', relation: 'blocks', direction: 'out' },
        where: [
          { kind: 'field', field: `cf.${FIELD}`, op: 'filled' },
          { kind: 'field', field: `cf.${FIELD}`, op: 'eq', value: 5 },
          { kind: 'field', field: `cf.${FIELD}`, op: 'eq', value: null },
          { kind: 'stage_is', stageId: STAGE },
          { kind: 'system_state', state: 'active' },
          { kind: 'outcome', outcome: 'success' },
          { kind: 'result_issued' },
        ],
        quantifier: 'any',
      }).where,
    ).toHaveLength(7);
  });

  it('граница: где больше лимита и битые поля отвергаются', () => {
    const where = Array.from({ length: CONDITION_LIMITS.predicates + 1 }, () => ({
      kind: 'result_issued',
    }));
    expect(() =>
      conditionQuerySchema.parse({ subject: { kind: 'self' }, where, quantifier: 'all' }),
    ).toThrow();
    expect(() =>
      conditionQuerySchema.parse({
        subject: { kind: 'ref_field', field: 'cf.not-uuid' },
        quantifier: 'all',
      }),
    ).toThrow();
    expect(() =>
      conditionQuerySchema.parse({ subject: { kind: 'self' }, quantifier: 'sometimes' }),
    ).toThrow();
  });
});

describe('интеграция выборки в правила перехода (#635)', () => {
  it('условие по записям прячет кнопку; проверка не пускает с настройкой обхода', () => {
    const rules = workflowTransitionRulesSchema.parse({
      conditions: [
        { kind: 'records', query: { subject: { kind: 'project' }, quantifier: 'any', where: [] } },
      ],
      validators: [
        {
          kind: 'records',
          title: 'Нельзя выдать, пока не приняты задания',
          query: {
            subject: { kind: 'subtasks' },
            where: [{ kind: 'outcome', outcome: 'success' }],
            quantifier: 'all',
          },
        },
      ],
      postFunctions: [],
    });
    expect(rules.conditions[0]!.kind).toBe('records');
    // Обход подставляется умолчанием: руководство проекта + право.
    expect(rules.validators[0]).toMatchObject({
      kind: 'records',
      override: DEFAULT_GATE_OVERRIDE,
    });
  });

  it('режим «формула» — и в условиях, и в проверках; подпись обязательна', () => {
    const rules = workflowTransitionRulesSchema.parse({
      conditions: [{ kind: 'formula', formula }],
      validators: [{ kind: 'formula', title: 'Формула договора', formula }],
    });
    expect(rules.validators[0]!.kind).toBe('formula');
    expect(() =>
      workflowTransitionRulesSchema.parse({
        validators: [{ kind: 'formula', formula }],
      }),
    ).toThrow();
  });

  it('настройка обхода: доп. сотрудники и роль в проекте; forbidden — никому', () => {
    expect(
      gateOverridePolicySchema.parse({ extraUserIds: [USER], projectRole: 'manager' }),
    ).toEqual({ mode: 'default', extraUserIds: [USER], projectRole: 'manager' });
    expect(gateOverridePolicySchema.parse({ mode: 'forbidden' }).extraUserIds).toEqual([]);
  });

  it('DTO-валидатор: без настройки обхода — override отвергнут, полный — принимает', () => {
    const base = {
      kind: 'records',
      title: 'Нельзя выдать',
      query: { subject: { kind: 'self' }, where: [], quantifier: 'all' },
    };
    expect(workflowValidatorDtoSchema.safeParse(base).success).toBe(true);
    // extraUserIds (до 50 uuid сотрудников) не должны уходить каждому, кто
    // видит карточку, — DTO их не несёт.
    expect(
      workflowValidatorDtoSchema.safeParse({
        ...base,
        override: { mode: 'default', extraUserIds: [] },
      }).success,
    ).toBe(false);
    expect(
      workflowValidatorDtoSchema.safeParse({
        kind: 'formula',
        title: 'Формула',
        formula,
        override: { mode: 'forbidden', extraUserIds: [] },
      }).success,
    ).toBe(false);
    expect(
      workflowValidatorSchema.safeParse({
        ...base,
        override: { mode: 'default', extraUserIds: [] },
      }).success,
    ).toBe(true);
  });
});
