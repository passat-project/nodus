import { describe, expect, it, vi } from 'vitest';

import { visibleTasksWhere, type Viewer } from '../access/task-visibility.js';
import { TaskFormulaValuesProvider } from './task-formula-values.provider.js';

/**
 * Видимость выборок агрегатов (A7-1/A7-2, #632 Р7). У безпроектной (личной)
 * задачи «своё дерево» не определено: связанные записи сужаются до зоны
 * видимости актора (та же функция, что у списка задач), а без актора выборки
 * пусты — иначе агрегат собирал бы ЛЮБЫЕ личные задачи портала. Задачи папки
 * фильтруются проектом папки: узел и его задачи живут в одном проекте.
 */

const HOST = '00000000-0000-4000-8000-000000000601';
const CHILD = '00000000-0000-4000-8000-000000000602';
const FOREIGN = '00000000-0000-4000-8000-000000000603';
const ACTOR = { id: 'u1', permissions: [] };
const VIEWER: Viewer = {
  id: 'u1',
  permissions: [],
  subordinateIds: [],
  visibleProjectIds: [],
  hiddenProjectIds: [],
};

interface Row {
  id: string;
  number: number;
  title: string;
  deadline: Date | null;
  createdAt: Date;
  stageId: string;
  assigneeId: string;
  creatorId: string;
  parentId: string | null;
  projectId: string | null;
  nodeId: string | null;
  typeId: string;
  confidential: boolean;
  deletedAt: Date | null;
  customFields: unknown;
}

function task(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    number: 1,
    title: 'Задача',
    deadline: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    stageId: 'stage-1',
    assigneeId: 'u1',
    creatorId: 'u1',
    parentId: HOST,
    projectId: null,
    nodeId: null,
    typeId: 'type-1',
    confidential: false,
    deletedAt: null,
    customFields: {},
    ...over,
  };
}

/** Prisma-фейк: `findMany` фильтрует по `projectId` — ровно тот столбец, из-за
 *  которого возможна утечка между проектами (A7-1/A7-2). */
function make(host: { projectId: string | null } | null, rows: Row[] = []) {
  const findMany = vi.fn(async (args: { where: { projectId?: string | null } }) =>
    rows.filter(
      (item) => args.where.projectId === undefined || item.projectId === args.where.projectId,
    ),
  );
  const prisma = {
    task: { findUnique: vi.fn(async () => host), findMany },
    taskRelation: {
      findMany: vi.fn(async () => [] as { fromTaskId: string; toTaskId: string }[]),
    },
  };
  const viewers = { resolve: vi.fn(async () => VIEWER) };
  const catalog = { stagesByIds: vi.fn(async () => []) };
  const provider = new TaskFormulaValuesProvider(
    prisma as never,
    viewers as never,
    catalog as never,
  );
  return { provider, prisma, findMany, viewers };
}

describe('TaskFormulaValuesProvider.subtasks: безпроектный хост (A7-1)', () => {
  it('актор — выборка сужается функцией видимости списка задач', async () => {
    const { provider, findMany, viewers } = make({ projectId: null }, [task(CHILD)]);
    const rows = await provider.subtasks(HOST, { actor: ACTOR });
    expect(rows.map((row) => row.id)).toEqual([CHILD]);
    expect(viewers.resolve).toHaveBeenCalledWith(ACTOR);
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      parentId: HOST,
      projectId: null,
      deletedAt: null,
      confidential: false,
    });
    // Участие актора (постановщик/ответственный/соисполнитель, надзор,
    // task.view_all) — ровно та же функция, что у списка задач.
    expect(where).toMatchObject(visibleTasksWhere(VIEWER, 'all'));
  });

  it('без актора (фоновый пересчёт) — пусто, без запроса задач', async () => {
    const { provider, prisma } = make({ projectId: null }, [task(CHILD)]);
    expect(await provider.subtasks(HOST)).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe('TaskFormulaValuesProvider.subtasks: хост своего проекта', () => {
  it('фильтр проекта, зона актора не нужна (проект проверен хостом)', async () => {
    const { provider, findMany, viewers } = make({ projectId: 'p1' }, [
      task(CHILD, { projectId: 'p1' }),
    ]);
    const rows = await provider.subtasks(HOST, { actor: ACTOR });
    expect(rows.map((row) => row.id)).toEqual([CHILD]);
    expect(viewers.resolve).not.toHaveBeenCalled();
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ parentId: HOST, projectId: 'p1' });
    expect(where).not.toHaveProperty('OR');
  });
});

describe('TaskFormulaValuesProvider.relatedTasks: безпроектный хост (A7-1)', () => {
  it('без актора — пусто: связи личной задачи не читаются в пересчёте', async () => {
    const { provider, prisma } = make({ projectId: null }, [task(FOREIGN)]);
    prisma.taskRelation.findMany.mockResolvedValueOnce([{ fromTaskId: HOST, toTaskId: FOREIGN }]);
    expect(await provider.relatedTasks(HOST, 'blocks', 'out')).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('с актором — только его зона видимости', async () => {
    const { provider, prisma, findMany } = make({ projectId: null }, [task(FOREIGN)]);
    prisma.taskRelation.findMany.mockResolvedValueOnce([{ fromTaskId: HOST, toTaskId: FOREIGN }]);
    const rows = await provider.relatedTasks(HOST, 'blocks', 'out', { actor: ACTOR });
    expect(rows.map((row) => row.id)).toEqual([FOREIGN]);
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ projectId: null, confidential: false });
    expect(where).toMatchObject(visibleTasksWhere(VIEWER, 'all'));
  });

  it('хоста нет — пусто (связи удалённой записи источником не бывают)', async () => {
    const { provider, prisma } = make(null, [task(FOREIGN)]);
    prisma.taskRelation.findMany.mockResolvedValueOnce([{ fromTaskId: HOST, toTaskId: FOREIGN }]);
    expect(await provider.relatedTasks(HOST, 'blocks', 'out', { actor: ACTOR })).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe('TaskFormulaValuesProvider.nodeTasks: проект папки (A7-2)', () => {
  it('задача с nodeId папки, но projectId чужого проекта — в выборку не попадает', async () => {
    const { provider } = make(null, [
      task(CHILD, { nodeId: 'n1', projectId: 'p1' }),
      task(FOREIGN, { nodeId: 'n1', projectId: 'p2' }),
    ]);
    const rows = await provider.nodeTasks('n1', 'p1');
    expect(rows.map((row) => row.id)).toEqual([CHILD]);
  });

  it('папка без проекта (аномалия данных) — пусто, без запроса', async () => {
    const { provider, prisma } = make(null, [task(CHILD, { nodeId: 'n1' })]);
    expect(await provider.nodeTasks('n1', null)).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});
