import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type CreationFieldSlot, type ProcessType } from '@nodus/contracts';

import { TaskFieldsWriter, type TaskFieldsRow } from './task-fields.writer.js';

/**
 * Обязательное при создании нельзя очистить (#432, Р5): проверка стоит в
 * общем писателе полей — её получают и PATCH карточки, и окно перехода.
 * Тип читается портом «Процессов», форма — контрактом (одна грамматика с
 * окном создания).
 */

const FIELD_ID = '33333333-3333-4333-8333-333333333333';

const ROW: TaskFieldsRow = {
  id: 't1',
  number: 7,
  typeId: 'type-1',
  parentId: null,
  assigneeId: 'bob',
  projectId: null,
  nodeId: null,
};

const slot = (key: CreationFieldSlot['key']): CreationFieldSlot => ({
  key,
  label: null,
  required: true,
  preset: null,
});

const type = (keys: CreationFieldSlot['key'][]): ProcessType =>
  ({
    id: 'type-1',
    category: 'task',
    creationForm: { fields: keys.map(slot), chips: [] },
  }) as unknown as ProcessType;

function setup(required: CreationFieldSlot['key'][] = []) {
  const repo = {
    lockTree: vi.fn(async () => void 0),
    lock: vi.fn(async () => void 0),
    parentIdOf: vi.fn(async () => ROW.parentId),
    isDescendant: vi.fn(async () => false),
    updateFields: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => ({
      ...ROW,
      title: 'Т',
      deadline: null,
      participants: [],
    })),
  };
  const facts = { customFieldsOf: vi.fn(async () => ({})) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const participantsRepo = { remove: vi.fn(async () => void 0) };
  const placements = { sync: vi.fn(async () => void 0) };
  const customFields = {
    prepareUpdate: vi.fn(async () => ({ next: {}, changes: [] })),
  };
  const catalog = { typeById: vi.fn(async () => type(required)) };
  const formulaCells = { lockedFieldIds: vi.fn(async () => new Set<string>()) };
  const projects = {
    assertNodeAllowed: vi.fn(async () => void 0),
    lockNodeStructure: vi.fn(async () => void 0),
  };
  const writer = new TaskFieldsWriter(
    repo as never,
    facts as never,
    eventBus as never,
    participantsRepo as never,
    placements as never,
    customFields as never,
    formulaCells as never,
    catalog as never,
    projects as never,
  );
  return { writer, repo, projects, customFields, formulaCells };
}

const apply = (
  writer: TaskFieldsWriter,
  patch: Parameters<TaskFieldsWriter['apply']>[3],
  fields: string[] = Object.keys(patch),
) => writer.apply({} as never, { id: 'alice', permissions: [] }, ROW, patch, fields);

describe('TaskFieldsWriter: обязательные поля типа (#432, Р5)', () => {
  it('очистка обязательного срока — 422 reason=clear, записи нет', async () => {
    const { writer, repo } = setup(['deadline']);
    await expect(apply(writer, { deadline: null })).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      details: { typeId: 'type-1', fields: ['deadline'], reason: 'clear' },
    });
    expect(repo.updateFields).not.toHaveBeenCalled();
  });

  it('очистка обязательного описания — 422', async () => {
    const { writer } = setup(['description']);
    await expect(apply(writer, { description: '' })).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      details: { fields: ['description'] },
    });
  });

  it('очистка обязательного атрибута типа — 422', async () => {
    const { writer } = setup([`cf.${FIELD_ID}`]);
    await expect(apply(writer, { customFields: { [FIELD_ID]: null } })).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      details: { fields: [`cf.${FIELD_ID}`] },
    });
  });

  it('новый срок вместо пустого — проходит', async () => {
    const { writer, repo } = setup(['deadline']);
    await apply(writer, { deadline: '2026-11-01T00:00:00.000Z' });
    expect(repo.updateFields).toHaveBeenCalled();
  });

  it('поле не обязательное — очистка проходит', async () => {
    const { writer, repo } = setup([]);
    await apply(writer, { deadline: null });
    expect(repo.updateFields).toHaveBeenCalled();
  });

  it('патч без полей формы (заголовок) не читает тип', async () => {
    const { writer, repo } = setup(['deadline']);
    await apply(writer, { title: 'Новое' });
    expect(repo.updateFields).toHaveBeenCalled();
  });
});

describe('TaskFieldsWriter: узел структуры (#467)', () => {
  const NODE_ID = '44444444-4444-4444-8444-444444444444';

  const applyOf = (
    writer: TaskFieldsWriter,
    row: TaskFieldsRow,
    patch: Parameters<TaskFieldsWriter['apply']>[3],
  ) => writer.apply({} as never, { id: 'alice', permissions: [] }, row, patch, Object.keys(patch));

  const projectRow = (): TaskFieldsRow => ({ ...ROW, projectId: 'p1', nodeId: 'n0' });

  it('nodeId без проекта у задачи — 422 PROJECT_NODE_INVALID, порт не звали', async () => {
    const { writer, projects } = setup();
    await expect(applyOf(writer, ROW, { nodeId: NODE_ID })).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_INVALID,
    });
    expect(projects.assertNodeAllowed).not.toHaveBeenCalled();
  });

  it('nodeId проверяется портом по проекту задачи под локом структуры', async () => {
    const { writer, projects } = setup();
    await applyOf(writer, projectRow(), { nodeId: NODE_ID });
    expect(projects.lockNodeStructure).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(projects.assertNodeAllowed).toHaveBeenCalledWith('p1', NODE_ID);
  });

  it('projectId в том же патче сбрасывает узел (nodeId=null в записи и событии)', async () => {
    const repo = {
      lockTree: vi.fn(async () => void 0),
      lock: vi.fn(async () => void 0),
      isDescendant: vi.fn(async () => false),
      updateFields: vi.fn(async () => void 0),
      findWithParticipants: vi.fn(async () => ({
        ...projectRow(),
        projectId: 'p2',
        nodeId: null,
        participants: [],
      })),
    };
    const eventBus = { emit: vi.fn(async () => void 0) };
    const writer = new TaskFieldsWriter(
      repo as never,
      { customFieldsOf: vi.fn(async () => ({})) } as never,
      eventBus as never,
      { remove: vi.fn(async () => void 0) } as never,
      { sync: vi.fn(async () => void 0) } as never,
      { prepareUpdate: vi.fn(async () => ({ next: {}, changes: [] })) } as never,
      { lockedFieldIds: vi.fn(async () => new Set<string>()) } as never,
      { typeById: vi.fn(async () => null) } as never,
      {
        assertNodeAllowed: vi.fn(async () => void 0),
        lockNodeStructure: vi.fn(async () => void 0),
      } as never,
    );
    await applyOf(writer, projectRow(), { projectId: 'p2' });
    expect(repo.updateFields).toHaveBeenCalledWith(expect.anything(), 't1', {
      projectId: 'p2',
      nodeId: null,
    });
    const updated = eventBus.emit.mock.calls.find(
      (call: unknown[]) => call[1] === 'task.updated',
    ) as unknown as [unknown, string, Record<string, unknown>] | undefined;
    expect(updated?.[2]).toMatchObject({ nodeId: null, previousNodeId: 'n0' });
  });
});

describe('TaskFieldsWriter: формульная блокировка ячейки (#660)', () => {
  it('запись значения в формульную ячейку — 422 FORMULA_CELL_LOCKED', async () => {
    const kit = setup();
    kit.customFields.prepareUpdate.mockResolvedValueOnce({
      next: { [FIELD_ID]: 'руками' },
      changes: [{ fieldId: FIELD_ID, from: null, to: 'руками' }],
    } as never);
    kit.formulaCells.lockedFieldIds.mockResolvedValueOnce(new Set([FIELD_ID]));
    await expect(
      apply(writer0(kit), { customFields: { [FIELD_ID]: 'руками' } }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORMULA_CELL_LOCKED,
      details: { fields: [FIELD_ID] },
    });
    expect(kit.repo.updateFields).not.toHaveBeenCalled();
  });

  it('формульная запись (formulaWrite) блокировку обходит', async () => {
    const kit = setup();
    kit.customFields.prepareUpdate.mockResolvedValueOnce({
      next: { [FIELD_ID]: '0359-1-КЖ1' },
      changes: [{ fieldId: FIELD_ID, from: null, to: '0359-1-КЖ1' }],
    } as never);
    await expect(
      kit.writer.apply(
        {} as never,
        { id: 'alice', permissions: [] },
        ROW,
        { customFields: { [FIELD_ID]: '0359-1-КЖ1' } },
        ['customFields'],
        { formulaWrite: true },
      ),
    ).resolves.toBeTruthy();
    expect(kit.formulaCells.lockedFieldIds).not.toHaveBeenCalled();
  });

  it('повтор того же значения блокировку не встречает (changes пуст)', async () => {
    const kit = setup();
    await apply(kit.writer, { customFields: { [FIELD_ID]: 'то же' } });
    expect(kit.formulaCells.lockedFieldIds).not.toHaveBeenCalled();
  });
});

function writer0(kit: ReturnType<typeof setup>): TaskFieldsWriter {
  return kit.writer;
}
