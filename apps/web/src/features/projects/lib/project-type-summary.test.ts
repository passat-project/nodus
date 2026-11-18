import { describe, expect, it } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

import {
  creationSummary,
  kindsSummary,
  kindIdsAfterToggle,
  typeMeta,
  visibleTypeKinds,
} from './project-type-summary.js';

const KIND = '11111111-1111-4111-8111-111111111111';
const ARCHIVED_KIND = '22222222-2222-4222-8222-222222222222';
const OTHER_KIND = '33333333-3333-4333-8333-333333333333';

function kind(overrides: Partial<NodeKind> = {}): NodeKind {
  return {
    id: KIND,
    name: 'Комплект',
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
    ...overrides,
  };
}

function type(overrides: Partial<ProjectType> = {}): ProjectType {
  return {
    id: '41000000-0000-4000-8000-000000000001',
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
    ...overrides,
  };
}

function processType(id: string, excluded: string[] = []): ProcessType {
  return {
    id,
    code: id,
    name: id,
    category: 'task',
    direction: null,
    icon: 'square-check',
    color: 'neutral',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: '42000000-0000-4000-8000-000000000001',
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: excluded, folderKindId: null, withoutProject: true },
    }),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
  } as ProcessType;
}

describe('creationSummary (#665)', () => {
  it('пусто, всё разрешено и «N из M»', () => {
    const projectType = type();
    expect(creationSummary(projectType, [])).toBe(ui.automation.creationScope.projectSummaryNone);
    expect(creationSummary(projectType, [processType('a')])).toBe(
      ui.automation.creationScope.projectSummaryAll,
    );
    expect(
      creationSummary(projectType, [processType('a'), processType('b', [projectType.id])]),
    ).toBe('Разрешены 1 из 2');
  });
});

describe('visibleTypeKinds', () => {
  it('живые виды + уже привязанные архивные, чужие архивные не показываются', () => {
    const kinds = [
      kind(),
      kind({ id: ARCHIVED_KIND, name: 'Старый', archivedAt: '2026-01-01T00:00:00.000Z' }),
      kind({ id: OTHER_KIND, name: 'Чужой', archivedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(
      visibleTypeKinds(type({ kindIds: [KIND, ARCHIVED_KIND] }), kinds).map((k) => k.id),
    ).toEqual([KIND, ARCHIVED_KIND]);
    expect(visibleTypeKinds(type({ kindIds: null }), kinds).map((k) => k.id)).toEqual([KIND]);
  });
});

describe('typeMeta', () => {
  it('счётчик видов — как мета строки «Процессов»', () => {
    const kinds = [kind(), kind({ id: OTHER_KIND, name: 'Раздел' })];
    expect(typeMeta(type({ kindIds: null }), kinds)).toBe('2 вида');
    expect(typeMeta(type({ kindIds: [KIND] }), kinds)).toBe('1 вид');
    expect(typeMeta(type({ kindIds: [] }), kinds)).toBe('0 видов');
  });
});

describe('kindsSummary', () => {
  it('null — «Все виды · N», явный список — «K из N»', () => {
    const kinds = [kind(), kind({ id: OTHER_KIND, name: 'Раздел' })];
    expect(kindsSummary(type({ kindIds: null }), kinds)).toBe('Все виды · 2');
    expect(kindsSummary(type({ kindIds: [KIND] }), kinds)).toBe('1 из 2');
    expect(kindsSummary(type({ kindIds: [] }), kinds)).toBe('0 из 2');
  });
});

describe('kindIdsAfterToggle', () => {
  const kinds = [kind(), kind({ id: OTHER_KIND, name: 'Раздел' })];

  it('снятие вида из «все виды» делает список явным', () => {
    expect(kindIdsAfterToggle(null, kinds, KIND, false)).toEqual([OTHER_KIND]);
  });

  it('возврат последнего вида в полный набор снова пишет null', () => {
    expect(kindIdsAfterToggle([KIND], kinds, OTHER_KIND, true)).toBeNull();
  });

  it('частичный набор остаётся явным; дубль не появляется', () => {
    expect(kindIdsAfterToggle([KIND], kinds, KIND, true)).toEqual([KIND]);
    expect(kindIdsAfterToggle([KIND, OTHER_KIND], kinds, KIND, false)).toEqual([OTHER_KIND]);
    expect(kindIdsAfterToggle([], kinds, KIND, true)).toEqual([KIND]);
  });
});
