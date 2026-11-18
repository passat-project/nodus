import { ErrorCode, normalizeTypeConfig, type ProcessType } from '@nodus/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { TaskCreationScope } from './task-creation-scope.service.js';

const PROJECT_TYPE = '11111111-1111-4111-8111-111111111111';
const KIND = '22222222-2222-4222-8222-222222222222';
const OTHER_KIND = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const NODE = '55555555-5555-4555-8555-555555555555';

function type(overrides: Partial<ProcessType> = {}): ProcessType {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    code: 'kit',
    name: 'Комплект',
    category: 'task',
    direction: null,
    icon: 'file-text',
    color: 'info',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: '77777777-7777-4777-8777-777777777777',
    config: normalizeTypeConfig({}),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...overrides,
  } as ProcessType;
}

function setup(opts: { projectTypeId?: string | null; kindId?: string | null } = {}) {
  const projects = {
    projectTypeOf: vi.fn(async () =>
      opts.projectTypeId === undefined
        ? { id: PROJECT_TYPE, name: 'Договор' }
        : opts.projectTypeId === null
          ? null
          : { id: opts.projectTypeId, name: 'Договор' },
    ),
    nodeKindOf: vi.fn(async () => (opts.kindId === undefined ? KIND : opts.kindId)),
  };
  const catalog = {
    typeById: vi.fn(async () => type()),
  };
  return {
    scope: new TaskCreationScope(projects as never, catalog as never),
    projects,
    catalog,
  };
}

const scopeOf = (creation: Partial<ReturnType<typeof normalizeTypeConfig>['creation']>) =>
  normalizeTypeConfig({ creation: { ...normalizeTypeConfig({}).creation, ...creation } });

describe('TaskCreationScope (#665)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('умолчание: разрешено везде — лишних чтений нет', async () => {
    const { scope, projects } = setup();
    await scope.assertCreate(type(), { projectId: PROJECT, nodeId: null });
    expect(projects.projectTypeOf).not.toHaveBeenCalled();
    expect(projects.nodeKindOf).not.toHaveBeenCalled();
  });

  it('тип проекта в исключениях — 422 PROCESS_TYPE_NOT_ALLOWED_IN_PROJECT', async () => {
    const { scope } = setup({ projectTypeId: PROJECT_TYPE });
    const entity = type({
      config: scopeOf({ excludedProjectTypeIds: [PROJECT_TYPE] }),
    });
    await expect(scope.assertCreate(entity, { projectId: PROJECT, nodeId: null })).rejects.toThrow(
      DomainException,
    );
    await expect(
      scope.assertCreate(entity, { projectId: PROJECT, nodeId: null }),
    ).rejects.toMatchObject({ code: ErrorCode.PROCESS_TYPE_NOT_ALLOWED_IN_PROJECT });
  });

  it('без проекта, а тип требует проект — 422 PROCESS_TYPE_PROJECT_REQUIRED', async () => {
    const { scope } = setup();
    await expect(
      scope.assertCreate(type({ config: scopeOf({ withoutProject: false }) }), {
        projectId: null,
        nodeId: null,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PROCESS_TYPE_PROJECT_REQUIRED });
  });

  it('письмо без проекта допустимо даже при withoutProject=false', async () => {
    const { scope } = setup();
    await expect(
      scope.assertCreate(type({ category: 'letter', config: scopeOf({ withoutProject: false }) }), {
        projectId: null,
        nodeId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('привязка к виду папки: без папки и в чужой папке — отказ', async () => {
    const { scope } = setup({ kindId: OTHER_KIND });
    const entity = type({ config: scopeOf({ folderKindId: KIND }) });
    await expect(
      scope.assertCreate(entity, { projectId: null, nodeId: null }),
    ).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED,
    });
    await expect(
      scope.assertCreate(entity, { projectId: PROJECT, nodeId: NODE }),
    ).rejects.toMatchObject({ code: ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED });
  });

  it('в папке нужного вида — можно', async () => {
    const { scope } = setup({ kindId: KIND });
    await expect(
      scope.assertCreate(type({ config: scopeOf({ folderKindId: KIND }) }), {
        projectId: PROJECT,
        nodeId: NODE,
      }),
    ).resolves.toBeUndefined();
  });

  it('модуль проектов выключен (тип проекта не пришёл) — не блокируем', async () => {
    const { scope } = setup({ projectTypeId: null });
    await expect(
      scope.assertCreate(type({ config: scopeOf({ excludedProjectTypeIds: [PROJECT_TYPE] }) }), {
        projectId: PROJECT,
        nodeId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('правка без смены места и типа — проверки нет', async () => {
    const { scope, catalog, projects } = setup();
    await scope.assertChange(
      { typeId: '66666666-6666-4666-8666-666666666666', projectId: PROJECT, nodeId: null },
      { projectId: PROJECT, nodeId: null },
    );
    expect(catalog.typeById).not.toHaveBeenCalled();
    expect(projects.projectTypeOf).not.toHaveBeenCalled();
  });

  it('перенос в проект — проверяется новый проект, а не старый', async () => {
    const { scope, projects, catalog } = setup({ projectTypeId: PROJECT_TYPE });
    catalog.typeById.mockResolvedValue(
      type({ config: scopeOf({ excludedProjectTypeIds: [PROJECT_TYPE] }) }),
    );
    await expect(
      scope.assertChange(
        { typeId: '66666666-6666-4666-8666-666666666666', projectId: null, nodeId: null },
        { projectId: PROJECT },
      ),
    ).rejects.toBeInstanceOf(DomainException);
    expect(projects.projectTypeOf).toHaveBeenCalledWith(PROJECT);
  });

  it('перенос задачи в чужую папку или в корень — 422 по виду папки (#665)', async () => {
    const { scope, catalog } = setup({ kindId: OTHER_KIND });
    catalog.typeById.mockResolvedValue(type({ config: scopeOf({ folderKindId: KIND }) }));
    const row = {
      typeId: '66666666-6666-4666-8666-666666666666',
      projectId: PROJECT,
      nodeId: NODE,
    };
    // В другая папка того же проекта — вид не тот.
    await expect(
      scope.assertChange(row, { nodeId: '88888888-8888-4888-8888-888888888888' }),
    ).rejects.toMatchObject({ code: ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED });
    // Вынос в корень проекта — папки нет вовсе.
    await expect(scope.assertChange(row, { nodeId: null })).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED,
    });
  });
});
