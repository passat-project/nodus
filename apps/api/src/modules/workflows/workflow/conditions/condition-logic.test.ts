import { describe, expect, it } from 'vitest';

import type { ConditionFieldOp, ConditionPredicate, CustomFieldValue } from '@nodus/contracts';

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

// --- Грани значений по типам атрибутов (#635, матрица op×тип) ---------------

const FIELD_MONEY = '55555555-5555-4555-8555-555555555555';
const FIELD_DATE = '66666666-6666-4666-8666-666666666666';
const FIELD_DATETIME = '77777777-7777-4777-8777-777777777770';
const FIELD_DURATION = '88888888-8888-4888-8888-888888888888';
const FIELD_BOOL = '99999999-9999-4999-8999-999999999999';
const FIELD_ENUM = 'aaaaaaa2-0000-4000-8000-000000000001';
const FIELD_MULTIENUM = 'aaaaaaa2-0000-4000-8000-000000000002';
const FIELD_USER = 'aaaaaaa2-0000-4000-8000-000000000003';
const FIELD_USERS = 'aaaaaaa2-0000-4000-8000-000000000004';
const FIELD_LINK = 'aaaaaaa2-0000-4000-8000-000000000005';
const FIELD_COUNTER = 'aaaaaaa2-0000-4000-8000-000000000006';
const FIELD_REF = 'aaaaaaa2-0000-4000-8000-000000000007';

const ITEM_A = 'bbbbbbb1-0000-4000-8000-00000000000a';
const ITEM_B = 'bbbbbbb1-0000-4000-8000-00000000000b';
const ITEM_C = 'bbbbbbb1-0000-4000-8000-00000000000c';
const ITEM_D = 'bbbbbbb1-0000-4000-8000-00000000000d';
const CUR_1 = 'ccccccc1-0000-4000-8000-000000000001';
const CUR_2 = 'ccccccc1-0000-4000-8000-000000000002';

const edgeDefs: ConditionFieldDefs = new Map([
  ...defs,
  [FIELD_MONEY, { id: FIELD_MONEY, type: 'money', settings: { currencyId: CUR_1 } }],
  [FIELD_DATE, { id: FIELD_DATE, type: 'date', settings: {} }],
  [FIELD_DATETIME, { id: FIELD_DATETIME, type: 'datetime', settings: {} }],
  [FIELD_DURATION, { id: FIELD_DURATION, type: 'duration', settings: {} }],
  [FIELD_BOOL, { id: FIELD_BOOL, type: 'bool', settings: {} }],
  [FIELD_ENUM, { id: FIELD_ENUM, type: 'enum', settings: {} }],
  [FIELD_MULTIENUM, { id: FIELD_MULTIENUM, type: 'multienum', settings: {} }],
  [FIELD_USER, { id: FIELD_USER, type: 'user', settings: {} }],
  [FIELD_USERS, { id: FIELD_USERS, type: 'users', settings: {} }],
  [FIELD_LINK, { id: FIELD_LINK, type: 'link', settings: {} }],
  [FIELD_COUNTER, { id: FIELD_COUNTER, type: 'counter', settings: {} }],
  [FIELD_REF, { id: FIELD_REF, type: 'task', settings: {} }],
]);

/** Короткий вызов предиката field на строке со значением. */
function fieldPasses(
  fieldId: string,
  raw: unknown,
  op: ConditionFieldOp,
  value?: CustomFieldValue | null,
): boolean {
  return predicatePasses(
    row({ id: '1', values: { [fieldId]: raw } }),
    { kind: 'field', field: `cf.${fieldId}`, op, value: value ?? null },
    noStages,
    edgeDefs,
  );
}

describe('field (#635): деньги', () => {
  it('eq/ne — сумма и валюта; порядок — только той же валюты', () => {
    expect(fieldPasses(FIELD_MONEY, { amount: 100, currencyId: CUR_1 }, 'eq', {
      amount: 100,
      currencyId: CUR_1,
    })).toBe(true);
    // Та же сумма другой валюты — не равно.
    expect(fieldPasses(FIELD_MONEY, { amount: 100, currencyId: CUR_2 }, 'eq', {
      amount: 100,
      currencyId: CUR_1,
    })).toBe(false);
    expect(fieldPasses(FIELD_MONEY, { amount: 100, currencyId: CUR_2 }, 'ne', {
      amount: 100,
      currencyId: CUR_1,
    })).toBe(true);
    // Сравнение сумм — только в одной валюте: чужая валюта несравнима (ложь).
    expect(
      fieldPasses(FIELD_MONEY, { amount: 500, currencyId: CUR_2 }, 'gt', {
        amount: 100,
        currencyId: CUR_1,
      }),
    ).toBe(false);
    expect(
      fieldPasses(FIELD_MONEY, { amount: 150, currencyId: CUR_1 }, 'gt', {
        amount: 100,
        currencyId: CUR_1,
      }),
    ).toBe(true);
    expect(
      fieldPasses(FIELD_MONEY, { amount: 100, currencyId: CUR_1 }, 'gte', {
        amount: 100,
        currencyId: CUR_1,
      }),
    ).toBe(true);
  });
});

describe('field (#635): даты и продолжительность', () => {
  it('date/datetime — лексикографически по ISO; duration — числом', () => {
    expect(fieldPasses(FIELD_DATE, '2026-03-15', 'eq', '2026-03-15')).toBe(true);
    expect(fieldPasses(FIELD_DATE, '2026-01-15', 'lt', '2026-03-15')).toBe(true);
    expect(fieldPasses(FIELD_DATE, '2026-06-01', 'lt', '2026-03-15')).toBe(false);
    expect(fieldPasses(FIELD_DATETIME, '2026-03-15T10:00:00.000Z', 'gte', '2026-03-15T08:00:00.000Z')).toBe(
      true,
    );
    expect(fieldPasses(FIELD_DURATION, 60, 'lte', 60)).toBe(true);
    expect(fieldPasses(FIELD_DURATION, 120, 'lte', 60)).toBe(false);
    // gt/gte/lt/lte без значения (null) — несравнимо, всегда ложь.
    expect(fieldPasses(FIELD_DATE, '2026-03-15', 'gt', null)).toBe(false);
  });
});

describe('field (#635): флаг', () => {
  it('хранится только true: eq true / ne true / пусто', () => {
    expect(fieldPasses(FIELD_BOOL, true, 'eq', true)).toBe(true);
    expect(fieldPasses(FIELD_BOOL, true, 'ne', true)).toBe(false);
    // «Нет» = пусто: eq null истинен на отсутствующем ключе, ne null — на true.
    expect(fieldPasses(FIELD_BOOL, undefined, 'eq', null)).toBe(true);
    expect(fieldPasses(FIELD_BOOL, true, 'ne', null)).toBe(true);
    expect(fieldPasses(FIELD_BOOL, undefined, 'filled')).toBe(false);
    expect(fieldPasses(FIELD_BOOL, true, 'filled')).toBe(true);
  });
});

describe('field (#635): списки и люди', () => {
  it('enum: eq/ne и in_any со скаляром; пустой список in_any — всегда ложь', () => {
    expect(fieldPasses(FIELD_ENUM, ITEM_A, 'eq', ITEM_A)).toBe(true);
    expect(fieldPasses(FIELD_ENUM, ITEM_B, 'ne', ITEM_A)).toBe(true);
    expect(fieldPasses(FIELD_ENUM, undefined, 'ne', ITEM_A)).toBe(true);
    expect(fieldPasses(FIELD_ENUM, ITEM_A, 'in_any', [ITEM_A, ITEM_B])).toBe(true);
    expect(fieldPasses(FIELD_ENUM, ITEM_A, 'in_any', [ITEM_C])).toBe(false);
    expect(fieldPasses(FIELD_ENUM, ITEM_A, 'in_any', [])).toBe(false);
  });

  it('multienum: eq поэлементно (порядок значим), in_any — пересечение', () => {
    expect(fieldPasses(FIELD_MULTIENUM, [ITEM_A, ITEM_B], 'eq', [ITEM_A, ITEM_B])).toBe(true);
    // Тот же набор в другом порядке — не равно (сравнение массивов
    // поэлементно, общая грамматика значений): фиксировано тестом.
    expect(fieldPasses(FIELD_MULTIENUM, [ITEM_B, ITEM_A], 'eq', [ITEM_A, ITEM_B])).toBe(false);
    expect(fieldPasses(FIELD_MULTIENUM, [ITEM_A, ITEM_B], 'in_any', [ITEM_A])).toBe(true);
    expect(fieldPasses(FIELD_MULTIENUM, [ITEM_B, ITEM_C], 'in_any', [ITEM_A])).toBe(false);
    expect(fieldPasses(FIELD_MULTIENUM, [ITEM_B, ITEM_C], 'in_any', [ITEM_B, ITEM_D])).toBe(true);
    expect(fieldPasses(FIELD_MULTIENUM, undefined, 'in_any', [ITEM_A])).toBe(false);
    // Явный null в JSONB — то же «пусто», что отсутствие ключа.
    expect(fieldPasses(FIELD_MULTIENUM, null, 'filled')).toBe(false);
    expect(fieldPasses(FIELD_MULTIENUM, null, 'not_filled')).toBe(true);
  });

  it('user/users: скаляр читается как массив (расширяющее чтение, Р3)', () => {
    expect(fieldPasses(FIELD_USER, ITEM_A, 'in_any', [ITEM_A, ITEM_B])).toBe(true);
    expect(fieldPasses(FIELD_USERS, [ITEM_A, ITEM_B], 'in_any', [ITEM_B, ITEM_C])).toBe(true);
    expect(fieldPasses(FIELD_USERS, [ITEM_C], 'in_any', [ITEM_A, ITEM_B])).toBe(false);
  });
});

describe('field (#635): строковые типы и ссылки', () => {
  it('link/counter: contains без учёта регистра, not_contains на пустом — истина', () => {
    expect(fieldPasses(FIELD_LINK, 'https://example.com/docs/KZH', 'contains', 'docs')).toBe(true);
    expect(fieldPasses(FIELD_LINK, '\\\\file\\share\\ov1', 'not_contains', 'docs')).toBe(true);
    expect(fieldPasses(FIELD_LINK, undefined, 'not_contains', 'docs')).toBe(true);
    expect(fieldPasses(FIELD_LINK, undefined, 'contains', 'docs')).toBe(false);
    expect(fieldPasses(FIELD_COUNTER, 'Вх-2026/118', 'eq', 'Вх-2026/118')).toBe(true);
    expect(fieldPasses(FIELD_COUNTER, 'Вх-2026/118', 'contains', 'вх-2026')).toBe(true);
    expect(fieldPasses(FIELD_COUNTER, 'Изм. 3', 'ne', 'Вх-2026/118')).toBe(true);
  });

  it('ссылки (task/letter/project/node/…): uuid-строки, eq/ne/filled', () => {
    expect(fieldPasses(FIELD_REF, ITEM_A, 'eq', ITEM_A)).toBe(true);
    expect(fieldPasses(FIELD_REF, ITEM_B, 'eq', ITEM_A)).toBe(false);
    expect(fieldPasses(FIELD_REF, ITEM_B, 'ne', ITEM_A)).toBe(true);
    expect(fieldPasses(FIELD_REF, undefined, 'eq', null)).toBe(true);
    expect(fieldPasses(FIELD_REF, undefined, 'ne', null)).toBe(false);
    expect(fieldPasses(FIELD_REF, ITEM_A, 'filled')).toBe(true);
  });
});

describe('result_issued (#635): отметка действует «с этого статуса и дальше»', () => {
  // Порядок вставки = порядок маршрута (sortOrder): draft → printed → done.
  const marked = stagesOf({ printed: true });
  const rowAt = (stageId: string) => row({ id: '1', stageId });

  it('стадия до отметки — не выдана', () => {
    expect(predicatePasses(rowAt('new'), { kind: 'result_issued' }, marked, defs)).toBe(false);
  });

  it('отмеченная стадия и все после неё — выданы (канон §11)', () => {
    expect(predicatePasses(rowAt('printed'), { kind: 'result_issued' }, marked, defs)).toBe(true);
    // «done» после «printed»: в фикстуре помечен сам — проверяем «после»
    // отдельным маршрутом, где отметка ТОЛЬКО на printed.
    const onlyPrinted: ConditionStageIndex = {
      stages: new Map([
        [
          TYPE_A,
          new Map([
            ['draft', { systemState: 'backlog', outcome: null, resultIssued: false }],
            ['printed', { systemState: 'active', outcome: null, resultIssued: true }],
            ['done', { systemState: 'closed', outcome: 'success', resultIssued: false }],
            ['cancelled', { systemState: 'closed', outcome: 'cancelled', resultIssued: false }],
          ]),
        ],
      ]),
    };
    expect(predicatePasses(rowAt('done'), { kind: 'result_issued' }, onlyPrinted, defs)).toBe(true);
    expect(predicatePasses(rowAt('cancelled'), { kind: 'result_issued' }, onlyPrinted, defs)).toBe(
      true,
    );
    expect(predicatePasses(rowAt('draft'), { kind: 'result_issued' }, onlyPrinted, defs)).toBe(
      false,
    );
  });
});
