import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { FORMULA_CELLS } from '../../custom-fields/ports/formula-cells.port.js';
import { ProjectReaderProvider } from './project-reader.provider.js';

function make(enabled = true) {
  const projects = {};
  const participants = {
    rolesByProject: vi.fn(async () => [
      { projectId: 'p-1', source: 'task' },
      { projectId: 'p-1', source: 'member' },
      { projectId: 'p-2', source: 'observer' },
      { projectId: 'p-3', source: 'manager' },
      { projectId: 'p-4', source: 'assistant' },
    ]),
    userIdsBySources: vi.fn(async () => ['u-1']),
  };
  const nodes = {};
  const featureFlags = { isEnabled: vi.fn(async () => enabled) };
  const provider = new ProjectReaderProvider(
    projects as never,
    participants as never,
    nodes as never,
    featureFlags as never,
    { get: vi.fn() } as never,
  );
  return { provider, participants };
}

describe('ProjectReaderProvider — роли решающих (#433)', () => {
  it('rolesIn: источник → бизнес-роль, participant = task|member', async () => {
    const { provider } = make();
    await expect(provider.rolesIn('u-1', ['p-1', 'p-2', 'p-3', 'p-4'])).resolves.toEqual({
      'p-1': ['participant'],
      'p-2': ['observer'],
      'p-3': ['manager'],
      'p-4': ['assistant'],
    });
  });

  it('rolesIn без проектов и при выключенном модуле — пусто', async () => {
    const { provider } = make();
    await expect(provider.rolesIn('u-1', [])).resolves.toEqual({});
    const disabled = make(false);
    await expect(disabled.provider.rolesIn('u-1', ['p-1'])).resolves.toEqual({});
  });

  it('usersWithRoles: роли разворачиваются в источники проекции', async () => {
    const { provider, participants } = make();
    await expect(provider.usersWithRoles('p-1', ['manager', 'participant'])).resolves.toEqual([
      'u-1',
    ]);
    expect(participants.userIdsBySources).toHaveBeenCalledWith(undefined, 'p-1', [
      'manager',
      'task',
      'member',
    ]);
  });

  it('usersWithRoles: пустой список ролей и выключенный модуль — пусто', async () => {
    const { provider } = make();
    await expect(provider.usersWithRoles('p-1', [])).resolves.toEqual([]);
    const disabled = make(false);
    await expect(disabled.provider.usersWithRoles('p-1', ['manager'])).resolves.toEqual([]);
  });
});

describe('ProjectReaderProvider — состав задачи секретного проекта (#674)', () => {
  function makeMembers(visibility: 'open' | 'secret', status: 'active' | 'archived' = 'active') {
    const projects = {
      findById: vi.fn(async () => ({ id: 'p-1', visibility, status })),
    };
    const participants = {
      rowsOfProject: vi.fn(async () => [
        {
          projectId: 'p-1',
          userId: 'manager-1',
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: 'p-1',
          userId: 'member-1',
          source: 'member',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: 'p-1',
          userId: 'observer-1',
          source: 'observer',
          observerKind: 'invited',
          createdAt: new Date(),
        },
      ]),
    };
    const featureFlags = { isEnabled: vi.fn(async () => true) };
    return new ProjectReaderProvider(
      projects as never,
      participants as never,
      {} as never,
      featureFlags as never,
      { get: vi.fn() } as never,
    );
  }

  it('открытый проект — любые сотрудники', async () => {
    await expect(
      makeMembers('open').assertMembersAllowed('p-1', ['outsider']),
    ).resolves.toBeUndefined();
  });

  it('секретный — руководство и участники проходят, наблюдатель и посторонний — нет', async () => {
    const provider = makeMembers('secret');
    await expect(
      provider.assertMembersAllowed('p-1', ['manager-1', 'member-1']),
    ).resolves.toBeUndefined();
    await expect(
      provider.assertMembersAllowed('p-1', ['observer-1', 'outsider']),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_TASK_MEMBERS_INVALID,
      details: { projectId: 'p-1', userIds: ['observer-1', 'outsider'] },
    });
  });

  it('архивный проект — отказ как раньше', async () => {
    await expect(
      makeMembers('secret', 'archived').assertMembersAllowed('p-1', ['manager-1']),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

/**
 * #657: чип проекта (задача/письмо/палитра/беседа) показывает шифр по
 * ЭФФЕКТИВНОМУ значению — как журнал проектов: формула типа считается на
 * чтении и в `customFields` не лежит.
 */
describe('ProjectReaderProvider — шифр чипа по эффективному значению (#657)', () => {
  const CODE = SYSTEM_FIELD_IDS.projectCode;
  const ACTOR = { id: 'u-1', permissions: [] };

  interface RefRow {
    id: string;
    typeId: string;
    values: unknown;
    name: string;
    color: string;
  }
  type State = { values: Record<string, unknown>; formulas: Record<string, unknown> };

  function makeRefs(opts: {
    rows: RefRow[];
    states?: Map<string, State>;
    visible?: string[];
    enabled?: boolean;
  }) {
    const projects = {
      refsByIds: vi.fn(async (ids: readonly string[]) =>
        opts.rows.filter((row) => ids.includes(row.id)),
      ),
      participantProjectIds: vi.fn(async () => []),
      openProjectIds: vi.fn(async () => opts.visible ?? opts.rows.map((row) => row.id)),
      secretProjectIds: vi.fn(async () => []),
    };
    const stateFor = vi.fn(
      async (
        kind: string,
        hostIds: readonly string[],
        tx?: unknown,
        places?: ReadonlyMap<string, string | null>,
      ) => {
        // Расчёт — вне транзакции и с подсказкой места на каждый id
        // (иначе stateFor читал бы проект отдельным запросом — N+1).
        if (kind !== 'project' || tx !== undefined) {
          throw new Error(`stateFor: ожидался проект без tx, получено ${kind}`);
        }
        for (const id of hostIds) {
          if (!places?.has(id)) throw new Error(`stateFor: нет места для ${id}`);
        }
        const result = new Map<string, State>();
        for (const id of hostIds) {
          const state = opts.states?.get(id);
          if (state) result.set(id, state);
        }
        return result;
      },
    );
    const moduleRef = { get: vi.fn(() => ({ stateFor })) };
    const provider = new ProjectReaderProvider(
      projects as never,
      {} as never,
      {} as never,
      { isEnabled: vi.fn(async () => opts.enabled ?? true) } as never,
      moduleRef as never,
    );
    return { provider, projects, stateFor, moduleRef };
  }

  const row = (over: Partial<RefRow> = {}): RefRow => ({
    id: 'p-1',
    typeId: 't-1',
    values: {},
    name: 'Офис на Немиге',
    color: 'blue',
    ...over,
  });

  it('шифр задан формулой типа → чип получает вычисленное значение', async () => {
    const { provider, stateFor, moduleRef } = makeRefs({
      rows: [row()],
      states: new Map([['p-1', { values: { [CODE]: 'ОФ-2026/17' }, formulas: { [CODE]: {} } }]]),
    });

    await expect(provider.refsFor(ACTOR, ['p-1'])).resolves.toEqual([
      { id: 'p-1', code: 'ОФ-2026/17', name: 'Офис на Немиге', color: 'blue' },
    ]);
    // Один батч-расчёт на список id; место (тип) — подсказкой, чтобы
    // stateFor не читал каждый проект отдельно (N+1).
    expect(stateFor).toHaveBeenCalledTimes(1);
    expect(stateFor.mock.calls[0]?.[0]).toBe('project');
    expect(stateFor.mock.calls[0]?.[1]).toEqual(['p-1']);
    expect(stateFor.mock.calls[0]?.[3]).toEqual(new Map([['p-1', 't-1']]));
    // Порт формул берётся лениво (ModuleRef): прямого DI-цикла нет.
    expect(moduleRef.get).toHaveBeenCalledWith(FORMULA_CELLS, { strict: false });
  });

  it('формулы типа нет → шифр из собственного значения, как было', async () => {
    const { provider, stateFor } = makeRefs({
      rows: [row({ values: { [CODE]: 'ОФ-1' } })],
    });

    await expect(provider.refsFor(ACTOR, ['p-1'])).resolves.toEqual([
      { id: 'p-1', code: 'ОФ-1', name: 'Офис на Немиге', color: 'blue' },
    ]);
    expect(stateFor).toHaveBeenCalledTimes(1);
  });

  it('несколько проектов в одном батче — один расчёт и разные шифры', async () => {
    const { provider, stateFor } = makeRefs({
      rows: [row(), row({ id: 'p-2', typeId: 't-1', values: { [CODE]: 'ОФ-2' }, name: 'Склад' })],
      states: new Map([['p-1', { values: { [CODE]: 'ОФ-2026/17' }, formulas: {} }]]),
    });

    await expect(provider.refsFor(ACTOR, ['p-1', 'p-2'])).resolves.toEqual([
      { id: 'p-1', code: 'ОФ-2026/17', name: 'Офис на Немиге', color: 'blue' },
      { id: 'p-2', code: 'ОФ-2', name: 'Склад', color: 'blue' },
    ]);
    expect(stateFor).toHaveBeenCalledTimes(1);
    expect(stateFor.mock.calls[0]?.[1]).toEqual(['p-1', 'p-2']);
    expect(stateFor.mock.calls[0]?.[3]).toEqual(
      new Map([
        ['p-1', 't-1'],
        ['p-2', 't-1'],
      ]),
    );
  });

  it('проект без customFields — шифр null, чип не теряется', async () => {
    const { provider } = makeRefs({ rows: [row({ values: null })] });

    await expect(provider.refsFor(ACTOR, ['p-1'])).resolves.toEqual([
      { id: 'p-1', code: null, name: 'Офис на Немиге', color: 'blue' },
    ]);
  });

  it('невидимый проект отсекается ДО расчёта формул (видимость сохранена)', async () => {
    const { provider, stateFor } = makeRefs({
      rows: [row(), row({ id: 'p-2', typeId: 't-1', values: { [CODE]: 'ОФ-2' } })],
      visible: ['p-1'],
      states: new Map([['p-1', { values: { [CODE]: 'ОФ-2026/17' }, formulas: {} }]]),
    });

    const refs = await provider.refsFor(ACTOR, ['p-1', 'p-2']);
    expect(refs.map((ref) => ref.id)).toEqual(['p-1']);
    expect(stateFor.mock.calls[0]?.[1]).toEqual(['p-1']);
  });

  it('refs (список бесед) — тоже эффективное значение шифра', async () => {
    const { provider } = makeRefs({
      rows: [row()],
      states: new Map([['p-1', { values: { [CODE]: 'ОФ-2026/17' }, formulas: {} }]]),
    });

    await expect(provider.refs(['p-1'])).resolves.toEqual([
      { id: 'p-1', code: 'ОФ-2026/17', name: 'Офис на Немиге', color: 'blue' },
    ]);
  });

  it('выключенный модуль — ссылок нет, формул не читаем', async () => {
    const { provider, projects, stateFor } = makeRefs({ rows: [row()], enabled: false });

    await expect(provider.refsFor(ACTOR, ['p-1'])).resolves.toEqual([]);
    expect(projects.refsByIds).not.toHaveBeenCalled();
    expect(stateFor).not.toHaveBeenCalled();
  });
});
