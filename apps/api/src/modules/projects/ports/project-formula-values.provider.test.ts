import { describe, expect, it, vi } from 'vitest';

import { ProjectFormulaValuesProvider } from './project-formula-values.provider.js';

/**
 * Проекты и папки как источники формул (#632, Р6/Р11): системные поля в типах
 * языка (`FORMULA_SYSTEM_FIELDS`), место записи (тип проекта / вид папки —
 * формула привязки) и срез папок проекта одним набором с видом пачкой (О2:
 * N+1 не нужен).
 */

const PROJECT = {
  id: 'p1',
  name: 'Договор №7',
  status: 'active',
  managerId: 'u-manager',
  startedAt: new Date('2026-01-15T00:00:00.000Z'),
  endsAt: null,
  typeId: 'type-1',
  customFields: { 'field-1': 'КЖ' },
};

const NODE = {
  id: 'n1',
  projectId: 'p1',
  parentId: 'n0',
  kindId: 'kind-1',
  name: 'Здание 1',
  customFields: { 'field-2': 12 },
  createdAt: new Date('2026-02-01T09:30:00.000Z'),
};

function make() {
  const projects = {
    findById: vi.fn<(id?: string, tx?: unknown) => Promise<typeof PROJECT>>(async () => PROJECT),
  };
  const nodes = {
    findById: vi.fn<(id?: string, tx?: unknown) => Promise<typeof NODE | null>>(async () => NODE),
    listByProject: vi.fn<(projectId?: string, tx?: unknown) => Promise<(typeof NODE)[]>>(
      async () => [NODE, { ...NODE, id: 'n2', kindId: 'kind-2' }],
    ),
  };
  const kinds = {
    findById: vi.fn<(id?: string, tx?: unknown) => Promise<{ id: string; name: string }>>(
      async () => ({ id: 'kind-1', name: 'Здание' }),
    ),
    namesByIds: vi.fn<(ids: readonly string[], tx?: unknown) => Promise<Map<string, string>>>(
      async () =>
        new Map([
          ['kind-1', 'Здание'],
          ['kind-2', 'Помещение'],
        ]),
    ),
  };
  const provider = new ProjectFormulaValuesProvider(
    projects as never,
    nodes as never,
    kinds as never,
  );
  return { provider, projects, nodes, kinds };
}

describe('ProjectFormulaValuesProvider (#632, Р6)', () => {
  it('проект: значения, системные поля и место (тип проекта), дерево — сам себе', async () => {
    const { provider, projects } = make();
    expect(await provider.project('p1')).toEqual({
      kind: 'project',
      id: 'p1',
      values: { 'field-1': 'КЖ' },
      system: {
        name: 'Договор №7',
        status: 'active',
        startDate: '2026-01-15',
        endDate: null,
        manager: 'u-manager',
      },
      projectId: 'p1',
      parentId: null,
      nodeId: null,
      placeId: 'type-1',
      confidential: false,
    });
    expect(projects.findById).toHaveBeenCalledWith('p1', undefined);
  });

  it('папка: вид — системное поле, место — вид папки; нет узла — null', async () => {
    const { provider, nodes } = make();
    expect(await provider.node('n1')).toEqual({
      kind: 'node',
      id: 'n1',
      values: { 'field-2': 12 },
      system: { name: 'Здание 1', kind: 'Здание', createdAt: '2026-02-01T09:30:00.000Z' },
      projectId: 'p1',
      parentId: 'n0',
      nodeId: null,
      placeId: 'kind-1',
      confidential: false,
    });
    nodes.findById.mockResolvedValueOnce(null);
    expect(await provider.node('nope')).toBeNull();
  });

  it('срез папок: вид каждой — одним запросом видов (О2)', async () => {
    const { provider, kinds } = make();
    const nodes = await provider.projectNodes('p1');
    expect(nodes.map((node) => node.system.kind)).toEqual(['Здание', 'Помещение']);
    expect(kinds.namesByIds).toHaveBeenCalledTimes(1);
    expect(kinds.namesByIds.mock.calls[0]![0]).toEqual(['kind-1', 'kind-2']);
  });

  it('пустой проект — без запроса видов', async () => {
    const { provider, nodes, kinds } = make();
    nodes.listByProject.mockResolvedValueOnce([]);
    expect(await provider.projectNodes('p1')).toEqual([]);
    expect(kinds.namesByIds).not.toHaveBeenCalled();
  });
});
