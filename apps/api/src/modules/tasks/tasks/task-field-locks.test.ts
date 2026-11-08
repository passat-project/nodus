import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type FieldLocks, type ProcessType } from '@nodus/contracts';

import { TaskFieldsWriter, type TaskFieldsRow } from './task-fields.writer.js';

/**
 * Замок записи на путях правки (#496, Р4): единый писатель полей — точка,
 * через которую ходят PATCH карточки, массовая правка и окно перехода.
 * Закреплённое не меняется ни рукой, ни bulk, ни API; постановщик/право
 * `task.edit_locked` — только с причиной; окно кнопки, которое снова просит
 * поле, пишет его мимо замка (В10); формула — не ручная правка.
 */

const DEADLINE = '2026-11-10T00:00:00.000Z';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KATE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FIELD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const ROW: TaskFieldsRow = {
  id: 't1',
  number: 7,
  typeId: 'type-1',
  parentId: null,
  assigneeId: BOB,
  projectId: null,
  nodeId: null,
};

const LOCKS: FieldLocks = {
  deadline: {
    editors: 'none',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: ALICE,
    source: { kind: 'creation' },
  },
  assignee: {
    editors: 'owners',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: ALICE,
    source: {
      kind: 'transition',
      transitionId: '33333333-3333-4333-8333-333333333333',
      name: 'Выдать',
    },
  },
  [`cf.${FIELD}`]: {
    editors: 'none',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: ALICE,
    source: { kind: 'creation' },
  },
};

const type = {
  id: 'type-1',
  category: 'task',
  creationForm: { fields: [], chips: [] },
} as unknown as ProcessType;

function setup(fieldLocks: FieldLocks = LOCKS) {
  const task = {
    ...ROW,
    creatorId: ALICE,
    title: 'Т',
    description: 'Старое',
    deadline: new Date(DEADLINE),
    priority: 'normal',
    plannedMinutes: 60,
    customFields: {},
    fieldLocks,
    participants: [],
  };
  const repo = {
    lockTree: vi.fn(async () => void 0),
    lock: vi.fn(async () => void 0),
    parentIdOf: vi.fn(async () => ROW.parentId),
    isDescendant: vi.fn(async () => false),
    updateFields: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => ({ ...task })),
  };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const participantsRepo = { remove: vi.fn(async () => void 0) };
  const placements = { sync: vi.fn(async () => void 0) };
  const customFields = {
    prepareUpdate: vi.fn(async () => ({
      next: { [FIELD]: 'значение' },
      changes: [{ fieldId: FIELD, from: null, to: 'значение' }],
    })),
  };
  const catalog = { typeById: vi.fn(async () => type) };
  const formulaCells = { lockedFieldIds: vi.fn(async () => new Set<string>()) };
  const projects = {
    assertNodeAllowed: vi.fn(async () => void 0),
    lockNodeStructure: vi.fn(async () => void 0),
  };
  const writer = new TaskFieldsWriter(
    repo as never,
    { customFieldsOf: vi.fn(async () => ({})) } as never,
    eventBus as never,
    participantsRepo as never,
    placements as never,
    customFields as never,
    formulaCells as never,
    catalog as never,
    projects as never,
  );
  return { writer, repo };
}

const apply = (
  writer: TaskFieldsWriter,
  patch: Parameters<TaskFieldsWriter['apply']>[3],
  opts: Parameters<TaskFieldsWriter['apply']>[5] = {},
  actor: { id: string; permissions: string[] } = { id: BOB, permissions: [] },
) => writer.apply({} as never, actor, ROW, patch, Object.keys(patch), opts);

describe('TaskFieldsWriter: замок записи (#496, Р4)', () => {
  it('замок «никто»: срок меняет даже постановщик — 422, записи нет', async () => {
    const { writer, repo } = setup();
    const editor = { id: ALICE, permissions: [] };
    await expect(
      apply(writer, { deadline: '2026-12-01T00:00:00.000Z' }, {}, editor),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: ['deadline'], reason: 'locked' },
    });
    expect(repo.updateFields).not.toHaveBeenCalled();
    // Правка тем же значением замок не трогает.
    await apply(writer, { deadline: DEADLINE }, {}, editor);
    expect(repo.updateFields).toHaveBeenCalledTimes(1);
  });

  it('замок «постановщик»: исполнитель — owners_only, постановщик без причины — reason_required', async () => {
    const { writer } = setup();
    await expect(apply(writer, { assigneeId: KATE })).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: ['assignee'], reason: 'owners_only' },
    });
    await expect(
      apply(writer, { assigneeId: KATE }, {}, { id: ALICE, permissions: [] }),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: ['assignee'], reason: 'reason_required' },
    });
  });

  it('постановщик с причиной — можно, lastChange в колонке', async () => {
    const { writer, repo } = setup();
    await apply(
      writer,
      { assigneeId: KATE },
      { lockReason: 'передаю задачу' },
      { id: ALICE, permissions: [] },
    );
    const data = (
      repo.updateFields.mock.calls[0] as unknown as [unknown, string, { fieldLocks: FieldLocks }]
    )[2]!;
    expect(data.fieldLocks.assignee?.lastChange).toMatchObject({
      by: ALICE,
      reason: 'передаю задачу',
    });
    expect(data.fieldLocks.deadline).toEqual(LOCKS.deadline);
  });

  it('право task.edit_locked снимает любой замок, но причина обязательна', async () => {
    const { writer } = setup();
    const force = { id: ROOT, permissions: ['task.edit_locked'] };
    await expect(
      apply(writer, { deadline: '2026-12-01T00:00:00.000Z' }, {}, force),
    ).rejects.toMatchObject({
      details: { reason: 'reason_required' },
    });
    await apply(
      writer,
      { deadline: '2026-12-01T00:00:00.000Z' },
      { lockReason: 'форс-мажор' },
      force,
    );
  });

  it('окно кнопки пишет свой ключ мимо замка (В10)', async () => {
    const { writer, repo } = setup();
    await apply(
      writer,
      { deadline: '2026-12-01T00:00:00.000Z' },
      { writableKeys: new Set(['deadline']) },
    );
    expect(repo.updateFields).toHaveBeenCalledTimes(1);
    const data = (
      repo.updateFields.mock.calls[0] as unknown as [unknown, string, { fieldLocks?: FieldLocks }]
    )[2]!;
    // Мимо замка — без следа ручной правки.
    expect(data.fieldLocks).toBeUndefined();
  });

  it('формульная запись — не ручная правка: замок не проверяется', async () => {
    const { writer, repo } = setup();
    // Ручная правка того же атрибута — 422, формульная проходит.
    await expect(apply(writer, { customFields: { [FIELD]: 'значение' } })).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: [`cf.${FIELD}`], reason: 'locked' },
    });
    await apply(writer, { customFields: { [FIELD]: 'значение' } }, { formulaWrite: true });
    expect(repo.updateFields).toHaveBeenCalledTimes(1);
  });

  it('без замков правка идёт как раньше', async () => {
    const { writer, repo } = setup({});
    await apply(writer, { deadline: '2026-12-01T00:00:00.000Z' });
    expect(repo.updateFields).toHaveBeenCalledTimes(1);
    const data = (
      repo.updateFields.mock.calls[0] as unknown as [unknown, string, { fieldLocks?: FieldLocks }]
    )[2]!;
    expect(data.fieldLocks).toBeUndefined();
  });
});
