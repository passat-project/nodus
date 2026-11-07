import { describe, expect, it, vi } from 'vitest';

import { RecordValuesProvider } from './record-values.provider.js';

/** Композиция портов владельцев в резолвер-контракт (#632, Р11): маршрутизация
 *  по виду носителя; секретный проект/папка невидимого проекта — null без
 *  оракула (Р7); выборки делегируются модулям-владельцам. */

const ACTOR = { id: 'user-1', permissions: [] };
const ID = '21000000-0000-4000-8000-000000000091';

function setup() {
  const tasks = {
    record: vi.fn(async () => ({ kind: 'task', id: ID })),
    subtasks: vi.fn(async () => [{ kind: 'task', id: 'sub' }]),
    relatedTasks: vi.fn(async () => [{ kind: 'task', id: 'rel' }]),
    nodeTasks: vi.fn(async () => [{ kind: 'task', id: 'node-task' }]),
  };
  const projects = {
    project: vi.fn(async () => ({ kind: 'project', id: ID })),
    node: vi.fn(async (id: string) =>
      id === 'gone' ? null : { kind: 'node', id, projectId: 'p1' },
    ),
    projectNodes: vi.fn(async () => [{ kind: 'node', id: 'n1' }]),
  };
  const letters = { record: vi.fn(async () => ({ kind: 'letter', id: ID })) };
  const projectsReader = { refsFor: vi.fn(async () => [{ id: ID }]) };
  const provider = new RecordValuesProvider(
    tasks as never,
    projects as never,
    letters as never,
    projectsReader as never,
  );
  return { provider, tasks, projects, letters, projectsReader };
}

describe('RecordValuesProvider.record (#632, Р11/Р7)', () => {
  it('задача и письмо — прямо владельцу', async () => {
    const d = setup();
    expect(await d.provider.record('task', ID)).toEqual({ kind: 'task', id: ID });
    expect(await d.provider.record('letter', ID)).toEqual({ kind: 'letter', id: ID });
    expect(d.projectsReader.refsFor).not.toHaveBeenCalled();
  });

  it('проект: без актёра — как есть; невидимый актёру — null без оракула', async () => {
    const d = setup();
    expect(await d.provider.record('project', ID)).toEqual({ kind: 'project', id: ID });
    d.projectsReader.refsFor.mockResolvedValue([]);
    expect(await d.provider.record('project', ID, { actor: ACTOR as never })).toBeNull();
    expect(d.projectsReader.refsFor).toHaveBeenCalledWith(ACTOR, [ID]);
  });

  it('папка: видимость по проекту; папка без проекта — как есть', async () => {
    const d = setup();
    d.projectsReader.refsFor.mockResolvedValue([]);
    expect(await d.provider.record('node', ID, { actor: ACTOR as never })).toBeNull();
    d.projects.node.mockResolvedValue({ kind: 'node', id: ID, projectId: null });
    expect(await d.provider.record('node', ID, { actor: ACTOR as never })).toEqual({
      kind: 'node',
      id: ID,
      projectId: null,
    });
    d.projects.node.mockResolvedValue(null);
    expect(await d.provider.record('node', 'gone')).toBeNull();
  });
});

describe('RecordValuesProvider: выборки (#632, Р11)', () => {
  it('подзадачи, связи, задачи папки и папки проекта делегируются', async () => {
    const d = setup();
    await d.provider.subtasks(ID);
    await d.provider.relatedTasks(ID, 'blocks', 'out');
    await d.provider.nodeTasks(ID, 'p1');
    await d.provider.projectNodes('p1');
    expect(d.tasks.subtasks).toHaveBeenCalledWith(ID, undefined, undefined);
    expect(d.tasks.relatedTasks).toHaveBeenCalledWith(ID, 'blocks', 'out', undefined, undefined);
    expect(d.tasks.nodeTasks).toHaveBeenCalledWith(ID, 'p1', undefined);
    expect(d.projects.projectNodes).toHaveBeenCalledWith('p1', undefined);
  });
});
