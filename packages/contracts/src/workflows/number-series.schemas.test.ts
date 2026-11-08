import { describe, expect, it } from 'vitest';

import {
  numberContainerKey,
  numberContainersReachable,
  resolveNumberContainers,
  type NumberContainer,
  type NumberPlace,
} from './number-container.js';
import {
  numberCountKey,
  numberCreateTriggerProblem,
  numberEmptySegments,
  numberPeriodKey,
  numberPeriodsAllowed,
  numberSeriesRuleSchema,
  renderNumberTemplate,
  type NumberSeriesRule,
  type NumberTemplateSegment,
} from './number-series.schemas.js';

const KIND_KOMPLEKT = '11111111-1111-4111-8111-111111111111';
const KIND_BUILDING = '22222222-2222-4222-8222-222222222222';
const at = { year: 2026, month: 11, day: 8 };

const rule = (over: Partial<NumberSeriesRule> = {}): NumberSeriesRule => ({
  containers: [],
  period: 'none',
  template: [{ kind: 'counter' }],
  startValue: 1,
  step: 1,
  ...over,
});

const place = (over: Partial<NumberPlace> = {}): NumberPlace => ({
  host: 'task',
  typeId: 'type-change',
  folders: [],
  projectId: null,
  portfolioId: null,
  projectTypeId: null,
  parentTaskId: null,
  fieldValue: () => null,
  ...over,
});

describe('numberSeriesRuleSchema (#630, модель v3)', () => {
  it('сквозная нумерация — пустой список условий', () => {
    expect(numberSeriesRuleSchema.safeParse(rule()).success).toBe(true);
  });

  it('до трёх условий сразу («внутри здания по марке»), дубли запрещены', () => {
    const two: NumberContainer[] = [
      { kind: 'folder', nodeKindId: KIND_BUILDING },
      { kind: 'field', fieldNumber: 7 },
    ];
    expect(numberSeriesRuleSchema.safeParse(rule({ containers: two })).success).toBe(true);
    expect(
      numberSeriesRuleSchema.safeParse(
        rule({ containers: [{ kind: 'project' }, { kind: 'project' }] }),
      ).success,
    ).toBe(false);
    expect(
      numberSeriesRuleSchema.safeParse(
        rule({
          containers: [
            { kind: 'project' },
            { kind: 'portfolio' },
            { kind: 'record_type' },
            { kind: 'parent_task' },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('ровно один «Номер» в виде номера', () => {
    expect(
      numberSeriesRuleSchema.safeParse(rule({ template: [{ kind: 'year', digits: 4 }] })).success,
    ).toBe(false);
  });

  it('поле из папки требует вид папки, и только оно', () => {
    const folderField: NumberTemplateSegment = { kind: 'field', fieldNumber: 3, source: 'folder' };
    expect(
      numberSeriesRuleSchema.safeParse(rule({ template: [folderField, { kind: 'counter' }] }))
        .success,
    ).toBe(false);
    expect(
      numberSeriesRuleSchema.safeParse(
        rule({ template: [{ ...folderField, nodeKindId: KIND_KOMPLEKT }, { kind: 'counter' }] }),
      ).success,
    ).toBe(true);
    expect(
      numberSeriesRuleSchema.safeParse(
        rule({
          template: [
            { kind: 'field', fieldNumber: 3, source: 'project', nodeKindId: KIND_KOMPLEKT },
            { kind: 'counter' },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('шаг — от 1', () => {
    expect(numberSeriesRuleSchema.safeParse(rule({ step: 0 })).success).toBe(false);
    expect(numberSeriesRuleSchema.safeParse(rule({ step: 10 })).success).toBe(true);
  });
});

describe('numberPeriodsAllowed: без года номера соседних лет совпадут', () => {
  it('месяц без года — только «никогда»', () => {
    expect(numberPeriodsAllowed([{ kind: 'month' }, { kind: 'counter' }])).toEqual(['none']);
  });
  it('год — каждый год; год+месяц — ещё квартал и месяц; +день — каждый день', () => {
    expect(numberPeriodsAllowed([{ kind: 'counter' }, { kind: 'year', digits: 2 }])).toEqual([
      'none',
      'year',
    ]);
    expect(
      numberPeriodsAllowed([{ kind: 'year', digits: 4 }, { kind: 'month' }, { kind: 'counter' }]),
    ).toEqual(['none', 'year', 'quarter', 'month']);
    expect(
      numberPeriodsAllowed([
        { kind: 'year', digits: 4 },
        { kind: 'month' },
        { kind: 'day' },
        { kind: 'counter' },
      ]),
    ).toEqual(['none', 'year', 'quarter', 'month', 'day']);
    expect(
      numberPeriodsAllowed([{ kind: 'year', digits: 4 }, { kind: 'quarter' }, { kind: 'counter' }]),
    ).toEqual(['none', 'year', 'quarter']);
  });
  it('правило с месяцем без года и заново каждый месяц не сохраняется', () => {
    expect(
      numberSeriesRuleSchema.safeParse(
        rule({ period: 'month', template: [{ kind: 'month' }, { kind: 'counter' }] }),
      ).success,
    ).toBe(false);
  });
});

describe('ключ счёта и период', () => {
  it('письма — «2026» бит-в-бит (#55)', () => {
    expect(numberCountKey([], numberPeriodKey('year', at))).toBe('2026');
  });
  it('условия через «|», без частей — common', () => {
    expect(numberCountKey(['a', 'b'], '2026-Q4')).toBe('a|b|2026-Q4');
    expect(numberCountKey([], '')).toBe('common');
  });
  it('квартал, месяц, день', () => {
    expect(numberPeriodKey('quarter', at)).toBe('2026-Q4');
    expect(numberPeriodKey('month', at)).toBe('2026-11');
    expect(numberPeriodKey('day', at)).toBe('2026-11-08');
  });
});

describe('renderNumberTemplate', () => {
  it('книга «15-26», письмо «Вх-2026/118», накладная «0412-7», дата «20261108-1»', () => {
    expect(
      renderNumberTemplate(
        [{ kind: 'counter' }, { kind: 'literal', text: '-' }, { kind: 'year', digits: 2 }],
        { ...at, seq: 15 },
      ),
    ).toBe('15-26');
    expect(
      renderNumberTemplate(
        [
          { kind: 'literal', text: 'Вх' },
          { kind: 'literal', text: '-' },
          { kind: 'year', digits: 4 },
          { kind: 'literal', text: '/' },
          { kind: 'counter' },
        ],
        { ...at, seq: 118 },
      ),
    ).toBe('Вх-2026/118');
    expect(
      renderNumberTemplate(
        [
          { kind: 'field', fieldNumber: 9, source: 'project' },
          { kind: 'literal', text: '-' },
          { kind: 'counter' },
        ],
        { ...at, seq: 7, field: () => '0412' },
      ),
    ).toBe('0412-7');
    expect(
      renderNumberTemplate(
        [
          { kind: 'year', digits: 4 },
          { kind: 'month' },
          { kind: 'day' },
          { kind: 'literal', text: '-' },
          { kind: 'counter' },
          { kind: 'literal', text: '/К' },
          { kind: 'quarter' },
        ],
        { ...at, seq: 1 },
      ),
    ).toBe('20261108-1/К4');
  });
});

describe('numberEmptySegments: пустое поле — окно «выдать так / вернуться»', () => {
  it('находит пустые вставки', () => {
    const template: NumberTemplateSegment[] = [
      { kind: 'field', fieldNumber: 9, source: 'project' },
      { kind: 'literal', text: '-' },
      { kind: 'counter' },
    ];
    expect(numberEmptySegments(template, () => '  ')).toHaveLength(1);
    expect(numberEmptySegments(template, () => '0412')).toHaveLength(0);
  });
});

describe('resolveNumberContainers: значения условий по месту записи', () => {
  const kzh01 = { id: 'kzh01', kindId: KIND_KOMPLEKT };
  const building1 = { id: 'b1', kindId: KIND_BUILDING };

  it('«Изм.» в КЖ-01 — ближайшая папка вида «Комплект»', () => {
    const resolved = resolveNumberContainers(
      [{ kind: 'folder', nodeKindId: KIND_KOMPLEKT }],
      place({ folders: [kzh01, building1], projectId: 'p4' }),
    );
    expect(resolved).toEqual({ ok: true, hits: [{ entity: 'node', id: 'kzh01' }] });
  });

  it('два условия: здание × марка; нет марки — причина и номер условия', () => {
    const containers: NumberContainer[] = [
      { kind: 'folder', nodeKindId: KIND_BUILDING },
      { kind: 'field', fieldNumber: 7 },
    ];
    expect(
      resolveNumberContainers(
        containers,
        place({ host: 'node', folders: [building1], projectId: 'p4', fieldValue: () => 'mark-ov' }),
      ),
    ).toEqual({
      ok: true,
      hits: [
        { entity: 'node', id: 'b1' },
        { entity: 'value', id: 'mark-ov' },
      ],
    });
    expect(
      resolveNumberContainers(
        containers,
        place({ host: 'node', folders: [building1], projectId: 'p4' }),
      ),
    ).toEqual({ ok: false, reason: 'empty_field', index: 1 });
  });

  it('«папка, где лежит»: в корне проекта — сам проект', () => {
    expect(
      resolveNumberContainers([{ kind: 'parent_folder' }], place({ projectId: 'p4' })),
    ).toEqual({ ok: true, hits: [{ entity: 'project', id: 'p4' }] });
  });

  it('свой тип записи и портфель проекта-хоста', () => {
    expect(
      resolveNumberContainers(
        [{ kind: 'record_type' }, { kind: 'portfolio' }],
        place({ host: 'project', typeId: 'contract', portfolioId: 'metro' }),
      ),
    ).toEqual({
      ok: true,
      hits: [
        { entity: 'type', id: 'contract' },
        { entity: 'portfolio', id: 'metro' },
      ],
    });
  });

  it('письмо в папке не лежит — несовместимо', () => {
    expect(
      numberContainersReachable([{ kind: 'folder', nodeKindId: KIND_KOMPLEKT }], 'letter'),
    ).toBe(false);
    expect(numberContainerKey({ kind: 'field', fieldNumber: 7 })).toBe('field:7');
  });
});

describe('numberCreateTriggerProblem: письмо с почты приходит без проекта и полей', () => {
  it('сквозной номер письма при создании — можно', () => {
    expect(numberCreateTriggerProblem(rule(), 'letter')).toBeNull();
    expect(
      numberCreateTriggerProblem(rule({ containers: [{ kind: 'record_type' }] }), 'letter'),
    ).toBeNull();
  });
  it('по проекту или с полем письма — только кнопкой', () => {
    expect(numberCreateTriggerProblem(rule({ containers: [{ kind: 'project' }] }), 'letter')).toBe(
      'letter_place',
    );
    expect(
      numberCreateTriggerProblem(
        rule({
          template: [{ kind: 'field', fieldNumber: 2, source: 'self' }, { kind: 'counter' }],
        }),
        'letter',
      ),
    ).toBe('letter_fields');
    expect(
      numberCreateTriggerProblem(rule({ containers: [{ kind: 'project' }] }), 'task'),
    ).toBeNull();
  });
});
