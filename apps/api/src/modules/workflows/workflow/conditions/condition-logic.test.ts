import { describe, expect, it } from 'vitest';

import type { ConditionPredicate } from '@nodus/contracts';

import type { ConditionFieldDefs, ConditionRow, ConditionStageIndex } from './condition-logic.js';
import { evaluateSelection, predicatePasses, recordsReason } from './condition-logic.js';

/** uuid-подобные id: значения произвольные, важна стабильность в тесте. */
const TYPE_A = '11111111-1111-4111-8111-111111111111';
const TYPE_B = '22222222-2222-4222-8222-222222222222';
const STAGE_DONE = 'aaaaaaa1-0000-4000-8000-000000000003';
const FIELD_NUM = '33333333-3333-4333-8333-333333333333';
const FIELD_TEXT = '44444444-4444-4444-8444-444444444444';

const defs: ConditionFieldDefs = new Map([
  [FIELD_NUM, { id: FIELD_NUM, type: 'number', settings: {} }],
  [FIELD_TEXT, { id: FIELD_TEXT, type: 'text', settings: {} }],
]);

function stagesOf(marks: {
  printed?: boolean;
  closedOutcome?: string | null;
}): ConditionStageIndex {
  return {
    stages: new Map([
      [
        TYPE_A,
        new Map([
          ['new', { systemState: 'backlog', outcome: null, resultIssued: false }],
          [
            'printed',
            { systemState: 'active', outcome: null, resultIssued: marks.printed === true },
          ],
          [
            'done',
            {
              systemState: 'closed',
              outcome: marks.closedOutcome ?? 'success',
              resultIssued: marks.printed === true,
            },
          ],
        ]),
      ],
    ]),
  };
}

const row = (partial: Partial<ConditionRow> & { id: string }): ConditionRow => ({
  kind: 'task',
  name: 'Задача',
  typeId: TYPE_A,
  stageId: 'new',
  values: {},
  ...partial,
});

const noStages: ConditionStageIndex = { stages: new Map() };

describe('evaluateSelection (#635): кванторы', () => {
  const where: ConditionPredicate[] = [{ kind: 'type_is', typeId: TYPE_A }];
  const rows = [
    row({ id: '1', typeId: TYPE_A }),
    row({ id: '2', typeId: TYPE_B }),
    row({ id: '3', typeId: TYPE_A }),
  ];

  it('all: истина только когда проходят все; нарушители — непрошедшие', () => {
    const result = evaluateSelection(rows, where, 'all', noStages, defs);
    expect(result.passed).toBe(false);
    expect(result.violators.map((v) => v.id)).toEqual(['2']);
  });

  it('all на пустой выборке — истина (vacuous)', () => {
    expect(evaluateSelection([], where, 'all', noStages, defs).passed).toBe(true);
  });

  it('any: истина если хоть одна; ложь — нарушители все', () => {
    expect(evaluateSelection(rows, where, 'any', noStages, defs).passed).toBe(true);
    const none = evaluateSelection(
      [row({ id: '2', typeId: TYPE_B })],
      where,
      'any',
      noStages,
      defs,
    );
    expect(none.passed).toBe(false);
    expect(none.violators.map((v) => v.id)).toEqual(['2']);
  });

  it('none: истина когда нет прошедших; нарушители — прошедшие', () => {
    const result = evaluateSelection(
      [row({ id: '2', typeId: TYPE_B })],
      where,
      'none',
      noStages,
      defs,
    );
    expect(result.passed).toBe(true);
    expect(result.violators).toEqual([]);
    const bad = evaluateSelection(rows, where, 'none', noStages, defs);
    expect(bad.passed).toBe(false);
    expect(bad.violators.map((v) => v.id)).toEqual(['1', '3']);
  });
});

describe('predicatePasses (#635): предикаты', () => {
  it('stage_is сравнивает стадию записи', () => {
    const predicate: ConditionPredicate = { kind: 'stage_is', stageId: STAGE_DONE };
    expect(predicatePasses(row({ id: '1', stageId: STAGE_DONE }), predicate, noStages, defs)).toBe(
      true,
    );
    expect(predicatePasses(row({ id: '1', stageId: 'new' }), predicate, noStages, defs)).toBe(
      false,
    );
  });

  it('system_state и outcome — по стадии маршрута типа записи', () => {
    const index = stagesOf({});
    const done = row({ id: '1', stageId: 'done' });
    expect(predicatePasses(done, { kind: 'system_state', state: 'closed' }, index, defs)).toBe(
      true,
    );
    expect(predicatePasses(done, { kind: 'outcome', outcome: 'success' }, index, defs)).toBe(true);
    expect(predicatePasses(done, { kind: 'outcome', outcome: 'cancelled' }, index, defs)).toBe(
      false,
    );
    // Стадии нет в маршруте типа (чужой тип) — предикат ложен.
    expect(
      predicatePasses(
        row({ id: '1', typeId: TYPE_B }),
        { kind: 'system_state', state: 'closed' },
        index,
        defs,
      ),
    ).toBe(false);
  });

  it('field: eq/ne/filled/not_filled/gt/contains/in_any', () => {
    const withNum = (n: number) => row({ id: '1', values: { [FIELD_NUM]: n } });
    expect(
      predicatePasses(
        withNum(5),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'eq', value: 5 },
        noStages,
        defs,
      ),
    ).toBe(true);
    expect(
      predicatePasses(
        withNum(5),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'ne', value: 5 },
        noStages,
        defs,
      ),
    ).toBe(false);
    // eq null — «пусто».
    expect(
      predicatePasses(
        row({ id: '1', values: {} }),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'eq', value: null },
        noStages,
        defs,
      ),
    ).toBe(true);
    expect(
      predicatePasses(
        withNum(10),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'gt', value: 9 },
        noStages,
        defs,
      ),
    ).toBe(true);
    expect(
      predicatePasses(
        withNum(10),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'lte', value: 9 },
        noStages,
        defs,
      ),
    ).toBe(false);
    // contains — без учёта регистра.
    expect(
      predicatePasses(
        row({ id: '1', values: { [FIELD_TEXT]: 'КЖ1.1 Комплект' } }),
        { kind: 'field', field: `cf.${FIELD_TEXT}`, op: 'contains', value: 'кж1.1' },
        noStages,
        defs,
      ),
    ).toBe(true);
    expect(
      predicatePasses(
        row({ id: '1', values: { [FIELD_TEXT]: 'КЖ1.1' } }),
        { kind: 'field', field: `cf.${FIELD_TEXT}`, op: 'not_contains', value: 'кж' },
        noStages,
        defs,
      ),
    ).toBe(false);
    // filled/not_filled.
    expect(
      predicatePasses(
        withNum(0),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'filled' },
        noStages,
        defs,
      ),
    ).toBe(true);
    expect(
      predicatePasses(
        row({ id: '1', values: {} }),
        { kind: 'field', field: `cf.${FIELD_NUM}`, op: 'not_filled' },
        noStages,
        defs,
      ),
    ).toBe(true);
    // Неизвестный атрибут — все значимые операции ложны (публикация ловит).
    expect(
      predicatePasses(
        withNum(1),
        { kind: 'field', field: `cf.${FIELD_TEXT}`, op: 'eq', value: 1 },
        noStages,
        defs,
      ),
    ).toBe(false);
  });

  it('result_issued: с отметками — стадия записи в множестве отметок', () => {
    const index = stagesOf({ printed: true });
    expect(
      predicatePasses(row({ id: '1', stageId: 'printed' }), { kind: 'result_issued' }, index, defs),
    ).toBe(true);
    expect(
      predicatePasses(row({ id: '1', stageId: 'new' }), { kind: 'result_issued' }, index, defs),
    ).toBe(false);
    // Отметки есть, но запись на стадии до отметки — не выдана, даже закрытая
    // с другим итогом... закрытая успешно тоже не выдана: отметки заданы явно.
    expect(
      predicatePasses(
        row({ id: '1', stageId: 'done', values: {} }),
        { kind: 'result_issued' },
        stagesOf({ printed: true, closedOutcome: 'cancelled' }),
        defs,
      ),
    ).toBe(true);
  });

  it('result_issued: без отметок — выдана = закрыта успешно', () => {
    const index = stagesOf({}); // ни одной отметки
    expect(
      predicatePasses(row({ id: '1', stageId: 'done' }), { kind: 'result_issued' }, index, defs),
    ).toBe(true);
    const cancelled = stagesOf({ closedOutcome: 'cancelled' });
    expect(
      predicatePasses(
        row({ id: '1', stageId: 'done' }),
        { kind: 'result_issued' },
        cancelled,
        defs,
      ),
    ).toBe(false);
    expect(
      predicatePasses(row({ id: '1', stageId: 'new' }), { kind: 'result_issued' }, index, defs),
    ).toBe(false);
  });
});

describe('recordsReason (#635): видимость одна', () => {
  const violators = Array.from({ length: 7 }, (_, i) => row({ id: `v${i}` }));

  it('до 5 видимых записей, скрытые — счётчиком', () => {
    const visible = new Set(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    const reason = recordsReason('Не принято', violators, visible);
    expect(reason.kind).toBe('records');
    expect(reason.title).toBe('Не принято');
    expect(reason.records).toHaveLength(5);
    expect(reason.records![0]).toMatchObject({ id: 'v0', entityKind: 'task', name: 'Задача' });
    expect(reason.hiddenCount).toBe(0);
  });

  it('невидимые не называются: только счётчик', () => {
    const visible = new Set(['v1', 'v3']);
    const reason = recordsReason('Не принято', violators, visible);
    expect(reason.records!.map((r) => r.id)).toEqual(['v1', 'v3']);
    expect(reason.hiddenCount).toBe(5);
  });
});
