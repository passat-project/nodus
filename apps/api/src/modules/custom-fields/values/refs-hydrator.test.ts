import { describe, expect, it, vi } from 'vitest';

import { CustomFieldRefsHydrator } from './refs-hydrator.js';

/**
 * Гидратор ссылок (#431/#631, Р5/Р6): карточка получает имена сотрудников,
 * подразделений, вариантов и контрагентов одним набором пачек; архивные
 * помечаются; имя проекта — только видимое актёру (#52 Р13); у задач, писем
 * и папок удалённая цель — name null + archived, невидимая — name null;
 * вариант списка несёт цвет. Порты — моки.
 */

const ACTOR = { id: 'u-1', permissions: [] as string[] };

const USER = '11111111-1111-4111-8111-111111111111';
const RETIRED = '22222222-2222-4222-8222-222222222222';
const DEPARTMENT = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const COLORED_ITEM = '45454545-4545-4545-8545-454545454545';
const BYN = '55555555-5555-4555-8555-555555555555';
const COUNTERPARTY = '66666666-6666-4666-8666-666666666666';
const PROJECT = '77777777-7777-4777-8777-777777777777';
const TASK_OK = '88888888-8888-4888-8888-888888888888';
const TASK_DELETED = '90909090-9090-4090-8090-909090909090';
const TASK_HIDDEN = '91919191-9191-4191-8191-919191919191';
const LETTER = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const NODE_GONE = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';

const DICTIONARY = 'dict-1';

function makeHydrator() {
  const users = {
    findRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        displayName: `Сотрудник ${id.slice(0, 4)}`,
        avatarUrl: id === USER ? 'https://example.test/a.png' : null,
      })),
    ),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids.filter((id) => id !== RETIRED)),
    searchByDisplayName: vi.fn(),
  };
  const org = {
    subordinateIds: vi.fn(),
    departmentOf: vi.fn(),
    departmentRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `Отдел ${id.slice(0, 4)}`, isActive: true })),
    ),
  };
  const dictionaries = {
    dictionaryRefs: vi.fn(),
    itemRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        dictionaryId: DICTIONARY,
        name: `Вариант ${id.slice(0, 4)}`,
        isActive: id !== ITEM,
        color: id === COLORED_ITEM ? 'info' : null,
      })),
    ),
    activeItemRef: vi.fn(),
  };
  const counterparties = {
    refs: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, name: 'ООО «Проба»' }))),
    activeRef: vi.fn(async (id: string) => ({ id, name: 'ООО «Проба»' })),
  };
  const projects = {
    refsFor: vi.fn(async (_actor: unknown, ids: string[]) =>
      ids.map((id) => ({ id, code: '2026-1', name: 'Тендер УП', color: 'blue' })),
    ),
  };
  const tasks = {
    refs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `Задача ${id.slice(0, 4)}`, deleted: id === TASK_DELETED })),
    ),
    visibleFor: vi.fn(async (id: string) => id !== TASK_DELETED && id !== TASK_HIDDEN),
  };
  const letters = {
    refs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `Вх-2026/1 · ${id.slice(0, 4)}`, deleted: false })),
    ),
    visibleFor: vi.fn(async (id: string) => id === LETTER),
  };
  const nodes = {
    // Узлы удаляются физически: отсутствующий в ответе = удалённый.
    refs: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id !== NODE_GONE)
        .map((id) => ({ id, name: `Папка ${id.slice(0, 4)}`, deleted: false })),
    ),
    visibleFor: vi.fn(async () => true),
  };
  const hydrator = new CustomFieldRefsHydrator(
    users as never,
    org as never,
    dictionaries as never,
    counterparties as never,
    projects as never,
    tasks as never,
    letters as never,
    nodes as never,
  );
  return { hydrator, users, counterparties, projects, tasks, letters, nodes };
}

describe('CustomFieldRefsHydrator (#431, Р6)', () => {
  it('сотрудники: имя и аватар, деактивированный — archived', async () => {
    const { hydrator } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-users', type: 'users' }],
      {
        'f-users': [USER, RETIRED],
      },
      ACTOR,
    );
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'user', id: USER, archived: false }),
        expect.objectContaining({ kind: 'user', id: RETIRED, archived: true }),
      ]),
    );
    expect(refs.find((ref) => ref.id === USER)?.avatarUrl).toBe('https://example.test/a.png');
  });

  it('деньги приносят валюту как ссылку словаря: имя для суммы', async () => {
    const { hydrator } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-money', type: 'money' }],
      { 'f-money': { amount: 10, currencyId: BYN } },
      ACTOR,
    );
    expect(refs).toEqual([
      expect.objectContaining({ kind: 'dictionary_item', id: BYN, archived: false }),
    ]);
  });

  it('вариант списка несёт цвет; архивный помечен archived (#631, Р6)', async () => {
    const { hydrator } = makeHydrator();
    const refs = await hydrator.hydrate(
      [
        { id: 'f-enum', type: 'enum' },
        { id: 'f-enum-colored', type: 'enum' },
      ],
      { 'f-enum': ITEM, 'f-enum-colored': COLORED_ITEM },
      ACTOR,
    );
    const archived = refs.find((ref) => ref.id === ITEM);
    expect(archived).toMatchObject({ kind: 'dictionary_item', archived: true, color: null });
    const colored = refs.find((ref) => ref.id === COLORED_ITEM);
    expect(colored).toMatchObject({ kind: 'dictionary_item', color: 'info' });
  });

  it('проект: имя из порта проектов; без актёра — «Запись недоступна»', async () => {
    const { hydrator, projects } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-project', type: 'project' }],
      {
        'f-project': PROJECT,
      },
      ACTOR,
    );
    expect(refs).toEqual([
      { kind: 'project', id: PROJECT, name: 'Тендер УП', avatarUrl: null, archived: false },
    ]);
    expect(projects.refsFor).toHaveBeenCalledWith(ACTOR, [PROJECT]);

    // Служебный вызов без актёра — имя скрыто, значение не теряется.
    const withoutActor = await hydrator.hydrate(
      [{ id: 'f-project', type: 'project' }],
      { 'f-project': PROJECT },
      undefined,
    );
    expect(withoutActor).toEqual([
      { kind: 'project', id: PROJECT, name: null, avatarUrl: null, archived: false },
    ]);
  });

  it('задача (#631, Р5): видимая — имя; удалённая — name null + archived; скрытая — name null', async () => {
    const { hydrator, tasks } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-task', type: 'task' }],
      { 'f-task': TASK_OK },
      ACTOR,
    );
    expect(refs).toEqual([
      {
        kind: 'task',
        id: TASK_OK,
        name: `Задача ${TASK_OK.slice(0, 4)}`,
        avatarUrl: null,
        archived: false,
      },
    ]);
    expect(tasks.visibleFor).toHaveBeenCalledWith(TASK_OK, ACTOR);

    const mixed = await hydrator.hydrate(
      [
        { id: 'f-del', type: 'task' },
        { id: 'f-hid', type: 'task' },
      ],
      { 'f-del': TASK_DELETED, 'f-hid': TASK_HIDDEN },
      ACTOR,
    );
    // Удалённая цель: история значения живёт, имя скрыто, помечена архивом.
    expect(mixed.find((ref) => ref.id === TASK_DELETED)).toEqual({
      kind: 'task',
      id: TASK_DELETED,
      name: null,
      avatarUrl: null,
      archived: true,
    });
    // Без доступа (не удалена): имя скрыто, архивности нет.
    expect(mixed.find((ref) => ref.id === TASK_HIDDEN)).toEqual({
      kind: 'task',
      id: TASK_HIDDEN,
      name: null,
      avatarUrl: null,
      archived: false,
    });
  });

  it('письмо: невидимое актёру — name null без archived', async () => {
    const { hydrator, letters } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-letter', type: 'letter' }],
      { 'f-letter': LETTER },
      ACTOR,
    );
    expect(refs.find((ref) => ref.id === LETTER)).toMatchObject({
      kind: 'letter',
      name: `Вх-2026/1 · ${LETTER.slice(0, 4)}`,
      archived: false,
    });
    expect(letters.visibleFor).toHaveBeenCalledWith(LETTER, ACTOR);

    const hidden = makeHydrator();
    hidden.letters.visibleFor = vi.fn(async () => false);
    const hiddenRefs = await hidden.hydrator.hydrate(
      [{ id: 'f-letter', type: 'letter' }],
      { 'f-letter': LETTER },
      ACTOR,
    );
    expect(hiddenRefs[0]).toMatchObject({ kind: 'letter', name: null, archived: false });
  });

  it('папка: физически удалённая (нет в порте) — name null + archived', async () => {
    const { hydrator, nodes } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-node', type: 'node' }],
      {
        'f-node': NODE_GONE,
      },
      ACTOR,
    );
    expect(refs).toEqual([
      { kind: 'node', id: NODE_GONE, name: null, avatarUrl: null, archived: true },
    ]);
    expect(nodes.refs).toHaveBeenCalledWith([NODE_GONE]);
  });

  it('пустые значения пропускаются, дубли не повторяются', async () => {
    const { hydrator, counterparties } = makeHydrator();
    const refs = await hydrator.hydrate(
      [
        { id: 'f-cp', type: 'counterparty' },
        { id: 'f-text', type: 'text' },
      ],
      { 'f-cp': COUNTERPARTY, 'f-text': '  ' },
      ACTOR,
    );
    expect(refs).toEqual([expect.objectContaining({ kind: 'counterparty', id: COUNTERPARTY })]);
    expect(counterparties.refs).toHaveBeenCalledWith([COUNTERPARTY]);
  });

  it('подразделение: имя из порта оргструктуры', async () => {
    const { hydrator } = makeHydrator();
    const refs = await hydrator.hydrate(
      [{ id: 'f-dep', type: 'department' }],
      {
        'f-dep': DEPARTMENT,
      },
      ACTOR,
    );
    expect(refs[0]).toMatchObject({ kind: 'department', id: DEPARTMENT, archived: false });
  });
});
