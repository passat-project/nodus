import { normalizeTypeConfig, type ProcessType } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import { singleProjectOf, typeAllowedAtPlace } from './task-create-scope.js';

const PROJECT_TYPE = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_TYPE = '22222222-2222-4222-8222-222222222222';
const KIND = '33333333-3333-4333-8333-333333333333';
const OTHER_KIND = '44444444-4444-4444-8444-444444444444';

const scope = (patch: Partial<ReturnType<typeof normalizeTypeConfig>['creation']> = {}) =>
  normalizeTypeConfig({ creation: { ...normalizeTypeConfig({}).creation, ...patch } });

function type(
  patch: Partial<ReturnType<typeof normalizeTypeConfig>['creation']> = {},
): ProcessType {
  return {
    id: '55555555-5555-4555-8555-555555555555',
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
    workflowId: '66666666-6666-4666-8666-666666666666',
    config: scope(patch),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
  } as ProcessType;
}

const projects = [
  { id: 'p1', typeId: PROJECT_TYPE },
  { id: 'p2', typeId: OTHER_PROJECT_TYPE },
];

describe('окно создания: где предлагать тип (#665)', () => {
  it('по умолчанию — везде и без проекта', () => {
    expect(typeAllowedAtPlace(type(), { projectTypeId: null, nodeKindId: null }, projects)).toBe(
      true,
    );
    expect(
      typeAllowedAtPlace(type(), { projectTypeId: PROJECT_TYPE, nodeKindId: null }, projects),
    ).toBe(true);
  });

  it('исключённый тип проекта — не предлагается, другой — предлагается', () => {
    const entity = type({ excludedProjectTypeIds: [PROJECT_TYPE] });
    expect(
      typeAllowedAtPlace(entity, { projectTypeId: PROJECT_TYPE, nodeKindId: null }, projects),
    ).toBe(false);
    expect(
      typeAllowedAtPlace(entity, { projectTypeId: OTHER_PROJECT_TYPE, nodeKindId: null }, projects),
    ).toBe(true);
  });

  it('без проекта нельзя, но проект единственный — тип предлагается и проект однозначен', () => {
    const entity = type({ withoutProject: false });
    const single = projects.filter((item) => item.id === 'p1');
    expect(typeAllowedAtPlace(entity, { projectTypeId: null, nodeKindId: null }, single)).toBe(
      true,
    );
    expect(singleProjectOf(scope({ withoutProject: false }).creation, single)?.id).toBe('p1');
  });

  it('без проекта нельзя и проектов много — тип не предлагается из общего меню', () => {
    expect(
      typeAllowedAtPlace(
        type({ withoutProject: false }),
        { projectTypeId: null, nodeKindId: null },
        projects,
      ),
    ).toBe(false);
    expect(singleProjectOf(scope({ withoutProject: false }).creation, projects)).toBeNull();
  });

  it('привязка к папке: только в папке нужного вида', () => {
    const entity = type({ folderKindId: KIND });
    expect(typeAllowedAtPlace(entity, { projectTypeId: null, nodeKindId: null }, projects)).toBe(
      false,
    );
    expect(
      typeAllowedAtPlace(entity, { projectTypeId: null, nodeKindId: OTHER_KIND }, projects),
    ).toBe(false);
    expect(typeAllowedAtPlace(entity, { projectTypeId: null, nodeKindId: KIND }, projects)).toBe(
      true,
    );
  });
});
