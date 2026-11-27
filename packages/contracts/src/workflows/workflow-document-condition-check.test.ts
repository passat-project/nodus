import { describe, expect, it } from 'vitest';

import type { CustomFieldDefinition } from '../custom-fields/custom-field.schemas.js';
import type { WorkflowDraftDocument } from './workflow-document.schemas.js';
import {
  CONDITION_FIELD_OPS_BY_TYPE,
  checkConditionRules,
  hasConditionFormulas,
  hasConditionRules,
} from './workflow-document-condition-check.js';
import type { WorkflowCheckOptions } from './workflow-document-check.js';

const TYPE_A = '11111111-1111-4111-8111-111111111111';
const TYPE_DEAD = '55555555-5555-4555-8555-555555555555';
const STAGE_OK = 'aaaaaaa1-0000-4000-8000-000000000001';
const STAGE_DEAD = 'aaaaaaa1-0000-4000-8000-00000000000d';
const NODE_KIND = '66666666-6666-4666-8666-666666666666';
const NODE_KIND_DEAD = '66666666-6666-4666-8666-66666666666d';
const FIELD_NUM = '33333333-3333-4333-8333-333333333333';
const FIELD_DEAD = '44444444-4444-4444-8444-44444444444d';
const FIELD_REF = '77777777-7777-4777-8777-777777777777';

const definitions = [
  { id: FIELD_NUM, type: 'number', settings: {} },
  { id: FIELD_REF, type: 'task', settings: {} },
] as unknown as readonly Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>[];

const opts = (extra: Partial<WorkflowCheckOptions> = {}): WorkflowCheckOptions => ({
  category: 'task',
  definitions,
  customFields: {
    active: new Set([FIELD_NUM, FIELD_REF, FIELD_DEAD]),
    inType: new Set([FIELD_NUM, FIELD_REF]),
  },
  conditionTypeFacts: new Set([TYPE_A]),
  conditionStageFacts: new Map([[TYPE_A, new Set([STAGE_OK])]]),
  conditionNodeKindFacts: new Set([NODE_KIND]),
  ...extra,
});

const docWith = (rules: unknown): WorkflowDraftDocument =>
  ({
    stages: [],
    transitions: [
      {
        id: 't1',
        code: null,
        name: 'Выдать',
        fromStageId: null,
        toStageId: 's1',
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules,
        form: { enabled: false, sections: [] },
      },
    ],
  }) as never;

const validator = (query: unknown, override?: unknown) => ({
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [
    {
      kind: 'records',
      title: 'Не принято',
      query,
      override: override ?? { mode: 'default', extraUserIds: [] },
    },
  ],
  postFunctions: [],
});

const codes = (doc: WorkflowDraftDocument, checkOpts = opts()): string[] => {
  const problems: { code: string }[] = [];
  checkConditionRules(doc, checkOpts, problems as never);
  return problems.map((p) => p.code);
};

describe('checkConditionRules (#635): публикация выборок', () => {
  it('субъект вне категории — ошибка (подзадачи у письма)', () => {
    const doc = docWith(
      validator({
        subject: { kind: 'subtasks' },
        where: [{ kind: 'type_is', typeId: TYPE_A }],
        quantifier: 'all',
      }),
    );
    expect(codes(doc, opts({ category: 'letter' }))).toContain('condition_subject_not_in_category');
    expect(codes(doc)).toEqual([]);
  });

  it('type_is на удалённый тип и stage_is на чужой статус — ошибки', () => {
    const doc = docWith(
      validator({
        subject: { kind: 'subtasks' },
        where: [
          { kind: 'type_is', typeId: TYPE_DEAD },
          { kind: 'stage_is', stageId: STAGE_DEAD },
        ],
        quantifier: 'all',
      }),
    );
    expect(codes(doc)).toEqual(
      expect.arrayContaining(['condition_type_unknown', 'condition_stage_unknown']),
    );
  });

  it('stage_is без type_is — ошибка', () => {
    const doc = docWith(
      validator({
        subject: { kind: 'subtasks' },
        where: [{ kind: 'stage_is', stageId: STAGE_OK }],
        quantifier: 'all',
      }),
    );
    expect(codes(doc)).toContain('condition_stage_without_type');
  });

  it('folderTypeId на удалённый вид — ошибка; живой вид проходит', () => {
    const query = (folderTypeId: string) => ({
      subject: { kind: 'project_folders', folderTypeId },
      where: [],
      quantifier: 'any',
    });
    expect(codes(docWith(validator(query(NODE_KIND_DEAD))))).toContain(
      'condition_folder_type_unknown',
    );
    expect(codes(docWith(validator(query(NODE_KIND))))).toEqual([]);
  });

  it('ref_field: удалённый атрибут и непривязанный к типу — ошибки', () => {
    const query = (field: string) => ({
      subject: { kind: 'ref_field', field },
      where: [],
      quantifier: 'any',
    });
    // Атрибут существует, но не привязан к типу маршрута.
    expect(codes(docWith(validator(query(`cf.${FIELD_DEAD}`))))).toContain(
      'custom_field_not_in_type',
    );
    expect(codes(docWith(validator(query(`cf.${FIELD_REF}`))))).toEqual([]);
  });

  it('field: несовместимый оператор — ошибка; совместимый проходит', () => {
    const predicate = (op: string) => ({
      subject: { kind: 'subtasks' },
      where: [
        { kind: 'type_is', typeId: TYPE_A },
        { kind: 'field', field: `cf.${FIELD_NUM}`, op },
      ],
      quantifier: 'all',
    });
    expect(codes(docWith(validator(predicate('contains'))))).toContain(
      'condition_field_op_incompatible',
    );
    expect(codes(docWith(validator(predicate('gte'))))).toEqual([]);
  });

  it('project_tasks/folder_type_tasks без фильтра — предупреждение', () => {
    const unfiltered = {
      subject: { kind: 'project_tasks' },
      where: [],
      quantifier: 'all',
    };
    const problems: { code: string; severity: string }[] = [];
    checkConditionRules(docWith(validator(unfiltered)), opts(), problems as never);
    expect(problems).toEqual([
      { code: 'condition_query_unfiltered', severity: 'warning', transitionId: 't1' },
    ]);
    // С предикатом type_is/field предупреждения нет.
    expect(
      codes(
        docWith(
          validator({
            ...unfiltered,
            where: [{ kind: 'type_is', typeId: TYPE_A }],
          }),
        ),
      ),
    ).toEqual([]);
    // Прочие субъекты без фильтра не шумят.
    expect(
      codes(docWith(validator({ subject: { kind: 'subtasks' }, where: [], quantifier: 'all' }))),
    ).toEqual([]);
  });

  it('без фактов проверки ссылок пропускаются (толерантность)', () => {
    const doc = docWith(
      validator({
        subject: { kind: 'folder_type_tasks', folderTypeId: NODE_KIND_DEAD },
        where: [
          { kind: 'type_is', typeId: TYPE_DEAD },
          { kind: 'stage_is', stageId: STAGE_DEAD },
        ],
        quantifier: 'all',
      }),
    );
    expect(
      codes(
        doc,
        opts({
          conditionTypeFacts: undefined,
          conditionStageFacts: undefined,
          conditionNodeKindFacts: undefined,
        }),
      ),
    ).toEqual([]);
  });
});

describe('hasConditionRules / hasConditionFormulas (#635)', () => {
  it('detektирует records и formula у переходов и действий', () => {
    const withRecords = docWith(
      validator({ subject: { kind: 'self' }, where: [], quantifier: 'all' }),
    );
    expect(hasConditionRules(withRecords)).toBe(true);
    expect(hasConditionFormulas(withRecords)).toBe(false);

    const withFormula = docWith({
      conditions: [{ kind: 'role_in', roles: ['assignee'] }],
      validators: [
        {
          kind: 'formula',
          title: 'Ф',
          formula: { kind: 'literal', value: true },
          override: { mode: 'default', extraUserIds: [] },
        },
      ],
      postFunctions: [],
    });
    expect(hasConditionRules(withFormula)).toBe(true);
    expect(hasConditionFormulas(withFormula)).toBe(true);

    const plain = docWith({
      conditions: [{ kind: 'role_in', roles: ['assignee'] }],
      validators: [{ kind: 'time_logged' }],
      postFunctions: [],
    });
    expect(hasConditionRules(plain)).toBe(false);
    expect(hasConditionFormulas(plain)).toBe(false);
  });
});

describe('CONDITION_FIELD_OPS_BY_TYPE (#635): матрица операторов', () => {
  it('числа и даты сравниваются, текст содержит, списки пересекаются', () => {
    expect(CONDITION_FIELD_OPS_BY_TYPE.number).toContain('gte');
    expect(CONDITION_FIELD_OPS_BY_TYPE.date).toContain('lt');
    expect(CONDITION_FIELD_OPS_BY_TYPE.text).not.toContain('gt');
    expect(CONDITION_FIELD_OPS_BY_TYPE.text).toContain('contains');
    expect(CONDITION_FIELD_OPS_BY_TYPE.multienum).toContain('in_any');
    expect(CONDITION_FIELD_OPS_BY_TYPE.users).toContain('in_any');
    expect(CONDITION_FIELD_OPS_BY_TYPE.bool).not.toContain('contains');
    // filled/not_filled доступны всем типам.
    for (const ops of Object.values(CONDITION_FIELD_OPS_BY_TYPE)) {
      expect(ops).toContain('filled');
      expect(ops).toContain('not_filled');
    }
  });
});
