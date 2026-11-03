import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { ProcessCatalogReaderProvider } from './process-catalog-reader.provider.js';

/** Read-порт «Процессов» (ADR-0012, ADR-0024): разрешение типа в маршрут с
 *  проверкой категории/архива/скрытости, гидратация типов и стадий, каталог
 *  стадий. Репозитории мокаются. */

const TYPE = {
  id: 'type-1',
  code: 'task.default',
  name: 'Стандартный',
  category: 'task',
  direction: null,
  icon: 'square-check',
  color: 'neutral',
  description: '',
  creatable: true,
  isSystem: true,
  sortOrder: 0,
  archivedAt: null as Date | null,
};

const stage = (id: string, workflowId = 'wf-1') => ({
  id,
  workflowId,
  code: null,
  name: `Стадия ${id}`,
  color: 'neutral',
  sortOrder: 0,
  systemState: 'backlog',
  outcome: null,
  isInitial: true,
  archivedAt: null,
});

function setup(type: Record<string, unknown> | null = TYPE) {
  const types = {
    findLiveById: vi.fn(async () => type),
    findByCode: vi.fn(async () => type),
    findById: vi.fn(async () => type),
    findByIds: vi.fn(async () => (type ? [type] : [])),
    workflowIdOf: vi.fn(async () => 'wf-1'),
    list: vi.fn(async () => [TYPE]),
    workflowMap: vi.fn(async () => new Map([[TYPE.id, 'wf-1']])),
  };
  const workflows = {
    findStages: vi.fn(async () => [stage('s1')]),
    stagesByIds: vi.fn(async () => [stage('s1')]),
    findStageById: vi.fn(async () => stage('s1')),
    creationOf: vi.fn(async () => null),
  };
  const membership = { effectiveRoles: vi.fn(async () => [] as { id: string; code: string }[]) };
  return {
    reader: new ProcessCatalogReaderProvider(
      types as never,
      workflows as never,
      membership as never,
    ),
    types,
    workflows,
    membership,
  };
}

describe('ProcessCatalogReader (#428)', () => {
  it('resolveType без id — системный «Стандартный» с маршрутом', async () => {
    const { reader } = setup();
    const type = await reader.resolveType(undefined, { category: 'task' });
    expect(type.id).toBe(TYPE.id);
    expect(type.workflowId).toBe('wf-1');
  });

  it('тип чужой категории — 404 (задача не идёт по маршруту письма)', async () => {
    const { reader } = setup({ ...TYPE, category: 'letter' });
    await expect(reader.resolveType(TYPE.id, { category: 'task' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('архивный тип — 404', async () => {
    const { reader } = setup({ ...TYPE, archivedAt: new Date() });
    await expect(reader.resolveType(TYPE.id, { category: 'task' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('скрытый тип при явном выборе — 409, при неявном — можно', async () => {
    const { reader } = setup({ ...TYPE, creatable: false });
    await expect(
      reader.resolveType(TYPE.id, { category: 'task', requireCreatable: true }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    await expect(reader.resolveType(undefined, { category: 'task' })).resolves.toMatchObject({
      id: TYPE.id,
    });
  });

  it('typeRefs и stagesByIds — пачкой, пустые списки без запросов', async () => {
    const { reader, types, workflows } = setup();
    await expect(reader.typeRefs([TYPE.id])).resolves.toEqual([
      {
        id: TYPE.id,
        code: TYPE.code,
        name: TYPE.name,
        category: 'task',
        icon: TYPE.icon,
        color: TYPE.color,
      },
    ]);
    await expect(reader.stagesByIds(['s1'])).resolves.toHaveLength(1);
    const typeCalls = types.findByIds.mock.calls.length;
    const stageCalls = workflows.stagesByIds.mock.calls.length;
    await reader.typeRefs([]);
    await reader.stagesByIds([]);
    expect(types.findByIds.mock.calls.length).toBe(typeCalls);
    expect(workflows.stagesByIds.mock.calls.length).toBe(stageCalls);
  });

  it('findLiveStage: архивная стадия — null', async () => {
    const { reader, workflows } = setup();
    workflows.findStageById.mockResolvedValueOnce({
      ...stage('s1'),
      archivedAt: new Date(),
    } as never);
    await expect(reader.findLiveStage('s1')).resolves.toBeNull();
  });

  it('stagesCatalog: одного типа и всех живых типов категории', async () => {
    const { reader } = setup();
    await expect(reader.stagesCatalog({ typeId: TYPE.id, category: 'task' })).resolves.toEqual([
      expect.objectContaining({ id: 's1', typeId: TYPE.id, typeName: TYPE.name }),
    ]);
    await expect(reader.stagesCatalog({ category: 'task' })).resolves.toEqual([
      expect.objectContaining({ id: 's1', typeId: TYPE.id }),
    ]);
  });
});
