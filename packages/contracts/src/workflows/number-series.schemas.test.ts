import { describe, expect, it } from 'vitest';

import {
  numberContainerReachable,
  numberHostHasButtons,
  resolveNumberContainer,
  type NumberPlace,
} from './number-container.js';
import {
  numberCountKey,
  numberPeriodKey,
  numberPeriodsAllowed,
  numberSeriesRuleSchema,
  renderNumberTemplate,
} from './number-series.schemas.js';

const RULE = {
  container: { kind: 'company' },
  period: 'year',
  template: [
    { kind: 'literal', text: 'Вх' },
    { kind: 'literal', text: '-' },
    { kind: 'year', digits: 4 },
    { kind: 'literal', text: '/' },
    { kind: 'counter' },
  ],
  startValue: 1,
} as const;

const KOMPLEKT = '44000000-0000-4000-8000-000000000007';
const OTHER_KIND = '44000000-0000-4000-8000-000000000005';
const KZH01 = '43000000-0000-4000-8000-000000000101';
const SUBFOLDER = '43000000-0000-4000-8000-000000000103';

function place(overrides: Partial<NumberPlace> = {}): NumberPlace {
  return {
    host: 'task',
    folders: [],
    projectId: null,
    portfolioId: null,
    projectTypeId: null,
    parentTaskId: null,
    fieldValue: () => null,
    ...overrides,
  };
}

describe('numberSeriesRuleSchema (#630)', () => {
  it('письмо-правило «Вх-ГГГГ/N» валидно; без issueOnCreate — только внешние источники', () => {
    expect(numberSeriesRuleSchema.parse(RULE)).toEqual({ ...RULE, issueOnCreate: false });
    expect(numberSeriesRuleSchema.parse({ ...RULE, issueOnCreate: true }).issueOnCreate).toBe(true);
  });

  it('кнопки процесса есть только у задач и писем', () => {
    expect(numberHostHasButtons('task')).toBe(true);
    expect(numberHostHasButtons('letter')).toBe(true);
    expect(numberHostHasButtons('node')).toBe(false);
    expect(numberHostHasButtons('project')).toBe(false);
  });

  it('папка, в которой лежит запись: ближайшая папка, в корне — проект', () => {
    const container = { kind: 'parent_folder' } as const;
    expect(
      resolveNumberContainer(
        container,
        place({ host: 'node', folders: [{ id: KZH01, kindId: KOMPLEKT }], projectId: 'p' }),
      ),
    ).toEqual({ ok: true, containerId: KZH01 });
    expect(resolveNumberContainer(container, place({ host: 'node', projectId: 'p' }))).toEqual({
      ok: true,
      containerId: 'p',
    });
    expect(numberContainerReachable(container, 'letter')).toBe(false);
  });

  it('ровно один «Номер»: без него и с двумя — отказ', () => {
    const noCounter = { ...RULE, period: 'none', template: [{ kind: 'literal', text: 'К' }] };
    expect(numberSeriesRuleSchema.safeParse(noCounter).success).toBe(false);
    const twoCounters = { ...RULE, template: [...RULE.template, { kind: 'counter' }] };
    expect(numberSeriesRuleSchema.safeParse(twoCounters).success).toBe(false);
  });

  it('«заново каждый год» без года в номере — отказ (номера лет совпали бы)', () => {
    const rule = { ...RULE, template: [{ kind: 'counter' }] };
    expect(numberSeriesRuleSchema.safeParse(rule).success).toBe(false);
    expect(numberSeriesRuleSchema.safeParse({ ...rule, period: 'none' }).success).toBe(true);
    expect(numberSeriesRuleSchema.safeParse({ ...RULE, period: 'month' }).success).toBe(false);
  });

  it('контейнер — реальная запись: папка требует вид, поле — номер атрибута', () => {
    expect(
      numberSeriesRuleSchema.safeParse({ ...RULE, container: { kind: 'folder' } }).success,
    ).toBe(false);
    expect(
      numberSeriesRuleSchema.safeParse({
        ...RULE,
        container: { kind: 'folder', nodeKindId: KOMPLEKT },
      }).success,
    ).toBe(true);
    expect(
      numberSeriesRuleSchema.safeParse({ ...RULE, container: { kind: 'field', fieldNumber: 7 } })
        .success,
    ).toBe(true);
  });

  it('старт меньше 1 и пустой шаблон — отказ', () => {
    expect(numberSeriesRuleSchema.safeParse({ ...RULE, startValue: 0 }).success).toBe(false);
    expect(numberSeriesRuleSchema.safeParse({ ...RULE, template: [] }).success).toBe(false);
  });
});

describe('период и ключ счёта', () => {
  it('допустимые «заново» следуют за датами в номере', () => {
    expect(numberPeriodsAllowed([{ kind: 'counter' }])).toEqual(['none']);
    expect(numberPeriodsAllowed(RULE.template)).toEqual(['none', 'year']);
    expect(
      numberPeriodsAllowed([{ kind: 'counter' }, { kind: 'month' }, { kind: 'year', digits: 2 }]),
    ).toEqual(['none', 'year', 'month']);
  });

  it('ключ: письма — «2026» (формат прода), папка — «uuid|2026», общий — common', () => {
    expect(numberCountKey(null, numberPeriodKey('year', { year: 2026, month: 3 }))).toBe('2026');
    expect(numberCountKey(KZH01, numberPeriodKey('none', { year: 2026, month: 3 }))).toBe(KZH01);
    expect(numberCountKey(KZH01, numberPeriodKey('month', { year: 2026, month: 3 }))).toBe(
      `${KZH01}|2026-03`,
    );
    expect(numberCountKey(null, '')).toBe('common');
  });

  it('книга изменений «15-26»: добивка и год двумя цифрами', () => {
    const template = [
      { kind: 'counter', minLength: 2 },
      { kind: 'literal', text: '-' },
      { kind: 'year', digits: 2 },
    ] as const;
    expect(renderNumberTemplate(template, { seq: 1, year: 2027, month: 1 })).toBe('01-27');
  });
});

describe('resolveNumberContainer — реальное место записи', () => {
  it('Кейс A: задача во вложенной папке — ближайшая «Комплект» выше', () => {
    const result = resolveNumberContainer(
      { kind: 'folder', nodeKindId: KOMPLEKT },
      place({
        folders: [
          { id: SUBFOLDER, kindId: OTHER_KIND },
          { id: KZH01, kindId: KOMPLEKT },
        ],
      }),
    );
    expect(result).toEqual({ ok: true, containerId: KZH01 });
  });

  it('Кейс A: задача не в комплекте — no_folder, номер не выдаётся', () => {
    const result = resolveNumberContainer(
      { kind: 'folder', nodeKindId: KOMPLEKT },
      place({ folders: [{ id: SUBFOLDER, kindId: OTHER_KIND }] }),
    );
    expect(result).toEqual({ ok: false, reason: 'no_folder' });
  });

  it('Кейс B: портфель через проект; без проекта или портфеля — причина', () => {
    const portfolio = { kind: 'portfolio' } as const;
    expect(resolveNumberContainer(portfolio, place({ projectId: 'p', portfolioId: 'g' }))).toEqual({
      ok: true,
      containerId: 'g',
    });
    expect(resolveNumberContainer(portfolio, place({ projectId: 'p' }))).toEqual({
      ok: false,
      reason: 'no_portfolio',
    });
    expect(resolveNumberContainer(portfolio, place())).toEqual({
      ok: false,
      reason: 'no_project',
    });
    expect(resolveNumberContainer(portfolio, place({ host: 'project', portfolioId: 'g' }))).toEqual(
      { ok: true, containerId: 'g' },
    );
  });

  it('тип проекта: все проекты типа — один счёт; без проекта — no_project', () => {
    const container = { kind: 'project_type' } as const;
    expect(
      resolveNumberContainer(container, place({ projectId: 'p', projectTypeId: 't' })),
    ).toEqual({ ok: true, containerId: 't' });
    expect(resolveNumberContainer(container, place())).toEqual({ ok: false, reason: 'no_project' });
    expect(
      resolveNumberContainer(container, place({ host: 'project', projectTypeId: 't' })),
    ).toEqual({ ok: true, containerId: 't' });
  });

  it('Кейс C: вся компания — контейнера нет (null), подходит любой записи', () => {
    for (const host of ['task', 'letter', 'node', 'project'] as const) {
      expect(resolveNumberContainer({ kind: 'company' }, place({ host }))).toEqual({
        ok: true,
        containerId: null,
      });
    }
  });

  it('совместимость: письма не в папках, проект не в проекте, подзадачи — только задачи', () => {
    const folder = { kind: 'folder', nodeKindId: KOMPLEKT } as const;
    expect(numberContainerReachable(folder, 'letter')).toBe(false);
    expect(numberContainerReachable(folder, 'project')).toBe(false);
    expect(numberContainerReachable({ kind: 'project' }, 'project')).toBe(false);
    expect(numberContainerReachable({ kind: 'project' }, 'letter')).toBe(true);
    expect(numberContainerReachable({ kind: 'parent_task' }, 'node')).toBe(false);
    expect(resolveNumberContainer(folder, place({ host: 'letter' }))).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('значение поля: пусто — empty_field, иначе id варианта/ссылки', () => {
    const container = { kind: 'field', fieldNumber: 7 } as const;
    expect(resolveNumberContainer(container, place())).toEqual({
      ok: false,
      reason: 'empty_field',
    });
    expect(
      resolveNumberContainer(container, place({ fieldValue: (n) => (n === 7 ? 'v' : null) })),
    ).toEqual({ ok: true, containerId: 'v' });
  });
});
