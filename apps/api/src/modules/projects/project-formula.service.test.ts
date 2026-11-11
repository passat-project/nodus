import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_FIELD_EVENTS, ErrorCode, type AuthUser, type FormulaNode } from '@nodus/contracts';

import { ProjectFormulaEvents } from './project-formula-events.js';
import { ProjectFormulaService } from './project-formula.service.js';

/**
 * Формула ячейки проекта и папки (#632, Р4/Р10): значение материализует
 * писатель модуля, `custom_field.formula_changed` уезжает адресно аудитории
 * проекта (O4); права мутаций — как у правки полей (архив — заморозка).
 * Move-preview — dry-run переноса папки: поддерево + задачи папок, без записи.
 */

const PROJECT = '00000000-0000-4000-8000-000000000001';
const NODE = '00000000-0000-4000-8000-000000000002';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const ASSISTANT = '00000000-0000-4000-8000-0000000000a2';
const FIELD = '00000000-0000-4000-8000-0000000000f1';
const AST = { kind: 'literal', type: 'number', value: 42 } as unknown as FormulaNode;

const user: AuthUser = {
  id: MANAGER,
  email: 'u@nodus.by',
  displayName: 'u',
  permissions: [],
};

/** Итог вычисления формулы (значение материализует писатель, Р4). */
interface Computation {
  value: number | null;
  error: { code: string; message: string } | null;
}

/** Узел дерева проекта для move-preview (порядок — fractional-ключ). */
function node(id: string, parentId: string | null, order: string) {
  return { id, parentId, order };
}

function make(options: { tree?: ReturnType<typeof node>[]; tasks?: string[] } = {}) {
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const projects = {
    assertVisible: vi.fn(async () => ({ id: PROJECT })),
    loadForManage: vi.fn(async () => ({ row: { id: PROJECT, status: 'active' } })),
    assertManageLocked: vi.fn(async () => void 0),
  };
  const repo = {
    findById: vi.fn(async () => ({ id: PROJECT, managerId: MANAGER, assistantIds: [ASSISTANT] })),
  };
  const nodes = {
    findInProject: vi.fn(async () => ({ id: NODE })),
    listByProject: vi.fn(async () => options.tree ?? [node(NODE, null, 'a1')]),
  };
  const taskReader = { taskIdsInNodes: vi.fn(async () => options.tasks ?? []) };
  const writer = {
    writeProject: vi.fn(async () => true),
    writeNode: vi.fn(async () => true),
    lockProject: vi.fn(async () => ({ id: PROJECT, visibility: 'open', status: 'active' })),
    lockNode: vi.fn(async () => void 0),
  };
  const participants = { rowsOfProject: vi.fn(async () => [{ userId: 'u-participant' }]) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const cells = {
    save: vi.fn<(tx?: unknown, args?: unknown) => Promise<Computation>>(async () => ({
      value: 42,
      error: null,
    })),
    remove: vi.fn(async () => void 0),
    depthOf: vi.fn(async () => 0 as number | null),
    read: vi.fn(async () => ({ ast: null, origin: null })),
    preview: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  };
  const events = new ProjectFormulaEvents(repo as never, participants as never, eventBus as never);
  const service = new ProjectFormulaService(
    txRunner as never,
    projects as never,
    nodes as never,
    writer as never,
    events,
    cells as never,
    taskReader as never,
  );
  return { service, projects, nodes, writer, participants, eventBus, cells, taskReader };
}

describe('ProjectFormulaService (#632, Р10)', () => {
  it('сохранение формулы проекта: значение — писателем, событие — аудитории проекта', async () => {
    const { service, writer, eventBus, participants } = make();
    expect(await service.save(user, PROJECT, FIELD, AST)).toEqual({ ast: AST, origin: 'own' });
    expect(writer.writeProject).toHaveBeenCalledWith(
      expect.anything(),
      MANAGER,
      PROJECT,
      FIELD,
      42,
    );
    expect(participants.rowsOfProject).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      {
        hostKind: 'project',
        hostId: PROJECT,
        fieldId: FIELD,
        hasError: false,
        audience: expect.arrayContaining([MANAGER, ASSISTANT, 'u-participant']),
      },
      expect.objectContaining({ aggregateType: 'project', aggregateId: PROJECT }),
    );
  });

  it('ошибка вычисления: значение пишется (пустое), hasError=true', async () => {
    const { service, cells, eventBus } = make();
    cells.save.mockResolvedValueOnce({
      value: null,
      error: { code: 'division_by_zero', message: 'x' },
    });
    await service.save(user, PROJECT, FIELD, AST);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      expect.objectContaining({ hasError: true }),
      expect.anything(),
    );
  });

  it('архивный проект без project.manage — 403 на мутации формулы', async () => {
    const { service, projects, cells } = make();
    projects.loadForManage.mockResolvedValueOnce({ row: { id: PROJECT, status: 'archived' } });
    await expect(service.save(user, PROJECT, FIELD, AST)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(cells.save).not.toHaveBeenCalled();
  });

  it('папка: значение пишется писателем узла, событие — адресное (hostKind node)', async () => {
    const { service, writer, eventBus } = make();
    await service.saveNode(user, PROJECT, NODE, FIELD, AST);
    expect(writer.writeNode).toHaveBeenCalledWith(
      expect.anything(),
      MANAGER,
      PROJECT,
      NODE,
      FIELD,
      42,
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      expect.objectContaining({ hostKind: 'node', hostId: NODE }),
      expect.objectContaining({ aggregateType: 'project_node', aggregateId: NODE }),
    );
  });
});

describe('ProjectFormulaService.movePreview (#632, Р10, критерий 1)', () => {
  const PARENT = '00000000-0000-4000-8000-0000000000b1';
  const CHILD = '00000000-0000-4000-8000-0000000000b2';
  const GRAND = '00000000-0000-4000-8000-0000000000b3';
  const TASK = '00000000-0000-4000-8000-0000000000c1';

  const tree = [
    node(PARENT, null, 'a1'),
    node(NODE, PARENT, 'a2'),
    node(CHILD, NODE, 'a3'),
    node(GRAND, CHILD, 'a4'),
  ];

  const entry = (hostKind: 'node' | 'task', hostId: string) => ({
    hostKind,
    hostId,
    fieldId: FIELD,
    hostLabel: 'Поз. 1',
    fieldName: 'Сумма',
    from: 10,
    to: 20,
  });

  it('поддерево + задачи папок: изменения папок и задач объединяются в один дифф', async () => {
    const { service, cells, taskReader } = make({ tree, tasks: [TASK] });
    const nodeChanges = [entry('node', NODE), entry('node', CHILD)];
    const taskChanges = [entry('task', TASK)];
    cells.preview.mockResolvedValueOnce(nodeChanges).mockResolvedValueOnce(taskChanges as never);

    const result = await service.movePreview(user, PROJECT, NODE, PARENT);

    // DFS от узла включительно: сам узел, ребёнок и внук (не сосед PARENT);
    // актор — фильтр видимости конфиденциальных задач (Р7).
    expect(taskReader.taskIdsInNodes).toHaveBeenCalledWith(PROJECT, [NODE, CHILD, GRAND], user.id);
    expect(cells.preview).toHaveBeenCalledWith('node', [NODE, CHILD, GRAND], {
      nodeParent: { [NODE]: PARENT },
    });
    expect(cells.preview).toHaveBeenCalledWith('task', [TASK], { nodeParent: { [NODE]: PARENT } });
    expect(result.changes).toEqual([...nodeChanges, ...taskChanges]);
  });

  it('цикл: перенос в собственное поддерево — PROJECT_NODE_CYCLE, без расчёта', async () => {
    const { service, cells } = make({ tree });
    await expect(service.movePreview(user, PROJECT, NODE, GRAND)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_CYCLE,
    });
    // Перенос «в себя» — тот же цикл.
    await expect(service.movePreview(user, PROJECT, NODE, NODE)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_CYCLE,
    });
    expect(cells.preview).not.toHaveBeenCalled();
  });

  it('чужой/несуществующий узел — PROJECT_NODE_INVALID без оракула', async () => {
    const { service, cells } = make({ tree });
    await expect(
      service.movePreview(user, PROJECT, NODE, '00000000-0000-4000-8000-0000000000ff'),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NODE_INVALID });
    await expect(
      service.movePreview(user, PROJECT, '00000000-0000-4000-8000-0000000000fe', PARENT),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NODE_INVALID });
    expect(cells.preview).not.toHaveBeenCalled();
  });

  it('нет прав на структуру — 403, расчёт не запускается', async () => {
    const { service, projects, cells } = make({ tree });
    projects.loadForManage.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { code: ErrorCode.FORBIDDEN }),
    );
    await expect(service.movePreview(user, PROJECT, NODE, PARENT)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(cells.preview).not.toHaveBeenCalled();
  });

  it('снятие формулы проекта без ячейки — no-op, событие не эмитится (#658)', async () => {
    const { service, cells, writer, eventBus } = make();
    cells.depthOf.mockResolvedValueOnce(null);
    await service.remove(user, PROJECT, FIELD);
    expect(cells.remove).not.toHaveBeenCalled();
    expect(writer.writeProject).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('снятие формулы папки без ячейки — no-op, событие не эмитится (#658)', async () => {
    const { service, cells, writer, eventBus } = make();
    cells.depthOf.mockResolvedValueOnce(null);
    await service.removeNode(user, PROJECT, NODE, FIELD);
    expect(cells.remove).not.toHaveBeenCalled();
    expect(writer.writeNode).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('снятие формулы проекта: замок строки берётся до проверки ячейки (#698)', async () => {
    const { service, writer, cells } = make();
    await service.remove(user, PROJECT, FIELD);
    expect(writer.lockProject).toHaveBeenCalledWith({}, PROJECT);
    expect(writer.lockProject.mock.invocationCallOrder[0]!).toBeLessThan(
      cells.depthOf.mock.invocationCallOrder[0]!,
    );
    expect(cells.remove).toHaveBeenCalledTimes(1);
  });

  it('снятие формулы папки: замок структуры и узла до проверки ячейки (#698)', async () => {
    const { service, writer, cells } = make();
    await service.removeNode(user, PROJECT, NODE, FIELD);
    expect(writer.lockNode).toHaveBeenCalledWith({}, PROJECT, NODE);
    expect(writer.lockNode.mock.invocationCallOrder[0]!).toBeLessThan(
      cells.depthOf.mock.invocationCallOrder[0]!,
    );
    expect(cells.remove).toHaveBeenCalledTimes(1);
  });

  it('ничего не меняется — пустой список (диалог «изменений нет»)', async () => {
    const { service } = make({ tree });
    expect(await service.movePreview(user, PROJECT, NODE, null)).toEqual({ changes: [] });
  });
});
