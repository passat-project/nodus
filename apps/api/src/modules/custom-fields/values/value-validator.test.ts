import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldSettings, CustomFieldType } from '@nodus/contracts';

import { CustomFieldValueValidator, type DefinitionFacts } from './value-validator.js';

/**
 * Валидатор значений (#431/#631, Р2/Р5): каждая причина отказа — отдельный
 * кейс; ссылки-записи (проект/задача/письмо/папка) — только видимые актёру,
 * без актёра не принимаются вовсе. Порты-источники ссылок — моки (ADR-0012).
 */

const ACTOR = { id: 'u-1', permissions: [] };

const definition = (
  id: string,
  type: CustomFieldType,
  settings: CustomFieldSettings = {},
): DefinitionFacts => ({ id, type, settings });

const USER = '11111111-1111-4111-8111-111111111111';
const RETIRED = '22222222-2222-4222-8222-222222222222';
const DEPARTMENT = '33333333-3333-4333-8333-333333333333';
const CLOSED_DEPARTMENT = '44444444-4444-4444-8444-444444444444';
const DICTIONARY = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const ARCHIVED_ITEM = '77777777-7777-4777-8777-777777777777';
const CURRENCY_DICTIONARY = '88888888-8888-4888-8888-888888888888';
const BYN = '99999999-9999-4999-8999-999999999999';
const COUNTERPARTY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LETTER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NODE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function makeValidator(
  opts: {
    activeCounterparties?: string[];
    visible?: { tasks?: string[]; letters?: string[]; nodes?: string[] };
  } = {},
) {
  const users = {
    findRefs: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id === USER || id === RETIRED)
        .map((id) => ({ id, displayName: `Сотрудник ${id.slice(0, 4)}`, avatarUrl: null })),
    ),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids.filter((id) => id === USER)),
    searchByDisplayName: vi.fn(),
  };
  const org = {
    subordinateIds: vi.fn(),
    departmentOf: vi.fn(),
    departmentRefs: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id === DEPARTMENT || id === CLOSED_DEPARTMENT)
        .map((id) => ({ id, name: `Отдел ${id.slice(0, 4)}`, isActive: id === DEPARTMENT })),
    ),
  };
  const dictionaries = {
    dictionaryRefs: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id === DICTIONARY || id === CURRENCY_DICTIONARY)
        .map((id) => ({
          id,
          code: id === CURRENCY_DICTIONARY ? 'currency' : 'list-00000001',
          name: 'Список',
          isSystem: id === CURRENCY_DICTIONARY,
        })),
    ),
    itemRefs: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id === ITEM || id === ARCHIVED_ITEM || id === BYN)
        .map((id) => ({
          id,
          dictionaryId: id === BYN ? CURRENCY_DICTIONARY : DICTIONARY,
          name: `Вариант ${id.slice(0, 4)}`,
          isActive: id !== ARCHIVED_ITEM,
          color: null,
        })),
    ),
    activeItemRef: vi.fn(),
  };
  const counterparties = {
    refs: vi.fn(async () => []),
    activeRef: vi.fn(async (id: string) =>
      (opts.activeCounterparties ?? [COUNTERPARTY]).includes(id)
        ? { id, name: 'Контрагент' }
        : null,
    ),
  };
  const projects = {
    viewScopeFor: vi.fn(
      async (): Promise<{ visibleProjectIds: string[]; hiddenProjectIds: string[] }> => ({
        visibleProjectIds: [],
        hiddenProjectIds: [],
      }),
    ),
  };
  const tasks = {
    refs: vi.fn(async () => []),
    visibleFor: vi.fn(async (id: string) => (opts.visible?.tasks ?? []).includes(id)),
  };
  const letters = {
    refs: vi.fn(async () => []),
    visibleFor: vi.fn(async (id: string) => (opts.visible?.letters ?? []).includes(id)),
  };
  const nodes = {
    refs: vi.fn(async () => []),
    visibleFor: vi.fn(async (id: string) => (opts.visible?.nodes ?? []).includes(id)),
  };
  const validator = new CustomFieldValueValidator(
    users as never,
    org as never,
    dictionaries as never,
    counterparties as never,
    projects as never,
    tasks as never,
    letters as never,
    nodes as never,
  );
  return { validator, users, org, dictionaries, counterparties, projects, tasks, letters, nodes };
}

describe('CustomFieldValueValidator (#431/#631)', () => {
  it('неизвестное поле и чужой тип — unknown/invalid без обращения к портам', async () => {
    const { validator, users } = makeValidator();
    const text = definition('f-text', 'text');
    const issues = await validator.validate([text], {
      'f-unknown': 'x',
      'f-text': 42,
    } as never);
    expect(issues).toEqual([
      { fieldId: 'f-unknown', reason: 'unknown', message: 'Unknown custom field' },
      { fieldId: 'f-text', reason: 'invalid', message: 'Value does not match field type' },
    ]);
    expect(users.findRefs).not.toHaveBeenCalled();
  });

  it('сотрудник: отсутствует — not_found, деактивирован — inactive', async () => {
    const { validator } = makeValidator();
    const user = definition('f-user', 'user');
    const users = definition('f-users', 'users');

    expect(
      (await validator.validate([user], { 'f-user': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }))[0]
        ?.reason,
    ).toBe('not_found');
    expect((await validator.validate([user], { 'f-user': RETIRED }))[0]?.reason).toBe('inactive');
    expect(await validator.validate([user], { 'f-user': USER })).toEqual([]);
    expect(await validator.validate([users], { 'f-users': [USER] })).toEqual([]);
    // Один деактивированный в пачке — отказ: новый выбор только активные.
    expect((await validator.validate([users], { 'f-users': [USER, RETIRED] }))[0]?.reason).toBe(
      'inactive',
    );
  });

  it('подразделение: архивное — inactive', async () => {
    const { validator } = makeValidator();
    const department = definition('f-dep', 'department');
    expect(
      (await validator.validate([department], { 'f-dep': CLOSED_DEPARTMENT }))[0]?.reason,
    ).toBe('inactive');
    expect(await validator.validate([department], { 'f-dep': DEPARTMENT })).toEqual([]);
  });

  it('список: вариант чужого справочника — not_found, архивный — inactive', async () => {
    const { validator } = makeValidator();
    const list = definition('f-list', 'enum', { dictionaryId: DICTIONARY });
    const other = definition('f-other', 'multienum', { dictionaryId: CURRENCY_DICTIONARY });
    expect((await validator.validate([list], { 'f-list': ARCHIVED_ITEM }))[0]?.reason).toBe(
      'inactive',
    );
    expect((await validator.validate([other], { 'f-other': [ITEM] }))[0]?.reason).toBe('not_found');
    expect(await validator.validate([list], { 'f-list': ITEM })).toEqual([]);
  });

  it('деньги: валюта только из системного справочника currency', async () => {
    const { validator } = makeValidator();
    const money = definition('f-money', 'money', { currencyId: BYN });
    expect(
      await validator.validate([money], { 'f-money': { amount: 10, currencyId: BYN } }),
    ).toEqual([]);
    // Элемент другого справочника — не валюта.
    expect(
      (await validator.validate([money], { 'f-money': { amount: 10, currencyId: ITEM } }))[0]
        ?.reason,
    ).toBe('not_found');
  });

  it('контрагент: архивный или отсутствующий — not_found (порт отдаёт только действующих)', async () => {
    const { validator } = makeValidator({ activeCounterparties: [] });
    const counterparty = definition('f-cp', 'counterparty');
    const issues = await validator.validate([counterparty], { 'f-cp': COUNTERPARTY });
    expect(issues[0]?.reason).toBe('not_found');
  });

  it('проект (#52 Р13): видимый актёру — принят; невидимый/без актёра — not_found', async () => {
    const { validator, projects } = makeValidator();
    const project = definition('f-project', 'project');

    projects.viewScopeFor.mockResolvedValueOnce({
      visibleProjectIds: [PROJECT],
      hiddenProjectIds: [],
    });
    const ok = await validator.validate([project], { 'f-project': PROJECT }, undefined, ACTOR);
    expect(ok).toEqual([]);
    expect(projects.viewScopeFor).toHaveBeenCalledWith(ACTOR);

    projects.viewScopeFor.mockResolvedValueOnce({
      visibleProjectIds: [],
      hiddenProjectIds: [PROJECT],
    });
    const rejected = await validator.validate(
      [project],
      { 'f-project': PROJECT },
      undefined,
      ACTOR,
    );
    expect(rejected[0]).toMatchObject({ fieldId: 'f-project', reason: 'not_found' });

    // без актёра значения-проекты не принимаются (служебные пути их не пишут)
    const noActor = await validator.validate([project], { 'f-project': PROJECT });
    expect(noActor[0]?.reason).toBe('not_found');
  });

  it('задача (#631 Р5): видимая актёру — принята; невидимая — not_found', async () => {
    const { validator, tasks } = makeValidator({ visible: { tasks: [TASK] } });
    const task = definition('f-task', 'task');
    expect(await validator.validate([task], { 'f-task': TASK }, undefined, ACTOR)).toEqual([]);
    expect(tasks.visibleFor).toHaveBeenCalledWith(TASK, ACTOR);

    const hidden = makeValidator({ visible: { tasks: [] } });
    const issues = await hidden.validator.validate(
      [definition('f-task', 'task')],
      { 'f-task': TASK },
      undefined,
      ACTOR,
    );
    expect(issues[0]).toMatchObject({
      fieldId: 'f-task',
      reason: 'not_found',
      message: 'Task not found or not visible',
    });
  });

  it('письмо и папка (#631 Р5): видимость — через свои порты', async () => {
    const { validator, letters, nodes } = makeValidator({
      visible: { letters: [LETTER], nodes: [NODE] },
    });
    const letter = definition('f-letter', 'letter');
    const node = definition('f-node', 'node');
    expect(
      await validator.validate(
        [letter, node],
        { 'f-letter': LETTER, 'f-node': NODE },
        undefined,
        ACTOR,
      ),
    ).toEqual([]);
    expect(letters.visibleFor).toHaveBeenCalledWith(LETTER, ACTOR);
    expect(nodes.visibleFor).toHaveBeenCalledWith(NODE, ACTOR);

    const invisible = makeValidator({ visible: {} });
    const issues = await invisible.validator.validate(
      [letter, node],
      { 'f-letter': LETTER, 'f-node': NODE },
      undefined,
      ACTOR,
    );
    expect(issues.map((issue) => issue.reason)).toEqual(['not_found', 'not_found']);
  });

  it('ссылки-записи без актёра не принимаются: порты видимости не спрашиваются', async () => {
    const { validator, tasks } = makeValidator({ visible: { tasks: [TASK] } });
    const task = definition('f-task', 'task');
    const letter = definition('f-letter', 'letter');
    const node = definition('f-node', 'node');
    const issues = await validator.validate([task, letter, node], {
      'f-task': TASK,
      'f-letter': LETTER,
      'f-node': NODE,
    });
    expect(issues).toEqual([
      { fieldId: 'f-task', reason: 'not_found', message: 'Record not found or not visible' },
      { fieldId: 'f-letter', reason: 'not_found', message: 'Record not found or not visible' },
      { fieldId: 'f-node', reason: 'not_found', message: 'Record not found or not visible' },
    ]);
    expect(tasks.visibleFor).not.toHaveBeenCalled();
  });

  it('больше 50 ключей — отказ без обращения к портам', async () => {
    const { validator, users } = makeValidator();
    const values = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`f-${index}`, 'x']),
    );
    const issues = await validator.validate([], values as never);
    expect(issues[0]?.reason).toBe('invalid');
    expect(users.findRefs).not.toHaveBeenCalled();
  });
});
