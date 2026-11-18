import { describe, expect, it } from 'vitest';

import {
  creationScopeViolation,
  DEFAULT_CREATION_SCOPE,
  normalizeCreationScope,
  typeAllowedInProjectType,
  withProjectTypeAllowed,
} from './creation-scope.js';
import { normalizeTypeConfig } from './process-type-config.js';

const PROJECT_TYPE = '11111111-1111-4111-8111-111111111111';
const OTHER_TYPE = '22222222-2222-4222-8222-222222222222';
const KIND = '33333333-3333-4333-8333-333333333333';

describe('creationScope (#665)', () => {
  it('нет настройки или мусор — разрешено везде и без проекта', () => {
    expect(normalizeCreationScope(undefined)).toEqual(DEFAULT_CREATION_SCOPE);
    expect(normalizeCreationScope('broken')).toEqual(DEFAULT_CREATION_SCOPE);
    expect(normalizeCreationScope({ excludedProjectTypeIds: ['not-a-uuid'] })).toEqual(
      DEFAULT_CREATION_SCOPE,
    );
  });

  it('настройка читается целиком, битая — умолчание', () => {
    expect(
      normalizeCreationScope({
        excludedProjectTypeIds: [PROJECT_TYPE],
        folderKindId: KIND,
        withoutProject: false,
      }),
    ).toEqual({
      excludedProjectTypeIds: [PROJECT_TYPE],
      folderKindId: KIND,
      withoutProject: false,
    });
    expect(normalizeCreationScope({ excludedProjectTypeIds: [PROJECT_TYPE] })).toEqual(
      DEFAULT_CREATION_SCOPE,
    );
  });

  it('тип проекта исключён — создавать нельзя; другой тип проекта — можно', () => {
    const scope = { ...DEFAULT_CREATION_SCOPE, excludedProjectTypeIds: [PROJECT_TYPE] };
    expect(
      creationScopeViolation(scope, {
        category: 'task',
        projectTypeId: PROJECT_TYPE,
        nodeKindId: null,
      }),
    ).toBe('project_type');
    expect(
      creationScopeViolation(scope, {
        category: 'task',
        projectTypeId: OTHER_TYPE,
        nodeKindId: null,
      }),
    ).toBeNull();
  });

  it('«без проекта»: задача — по флагу, письмо — всегда (регистрация без договора)', () => {
    const scope = { ...DEFAULT_CREATION_SCOPE, withoutProject: false };
    expect(
      creationScopeViolation(scope, { category: 'task', projectTypeId: null, nodeKindId: null }),
    ).toBe('project_required');
    expect(
      creationScopeViolation(scope, { category: 'letter', projectTypeId: null, nodeKindId: null }),
    ).toBeNull();
  });

  it('привязка к виду папки: нужна папка этого вида', () => {
    const scope = { ...DEFAULT_CREATION_SCOPE, folderKindId: KIND };
    expect(
      creationScopeViolation(scope, { category: 'task', projectTypeId: null, nodeKindId: null }),
    ).toBe('folder_kind');
    expect(
      creationScopeViolation(scope, {
        category: 'task',
        projectTypeId: null,
        nodeKindId: OTHER_TYPE,
      }),
    ).toBe('folder_kind');
    expect(
      creationScopeViolation(scope, { category: 'task', projectTypeId: null, nodeKindId: KIND }),
    ).toBeNull();
  });

  it('галочка с двух сторон правит одну связь: включение/выключение без дублей', () => {
    const excluded = withProjectTypeAllowed(DEFAULT_CREATION_SCOPE, PROJECT_TYPE, false);
    expect(excluded.excludedProjectTypeIds).toEqual([PROJECT_TYPE]);
    expect(typeAllowedInProjectType(excluded, PROJECT_TYPE)).toBe(false);
    expect(typeAllowedInProjectType(excluded, OTHER_TYPE)).toBe(true);
    // Повторное выключение не плодит дубль.
    expect(withProjectTypeAllowed(excluded, PROJECT_TYPE, false)).toEqual(excluded);
    expect(withProjectTypeAllowed(excluded, PROJECT_TYPE, true).excludedProjectTypeIds).toEqual([]);
  });

  it('конфигурация типа получает раздел «где создаётся» из умолчания', () => {
    expect(normalizeTypeConfig({}).creation).toEqual(DEFAULT_CREATION_SCOPE);
    expect(
      normalizeTypeConfig({
        creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: false },
      }).creation.withoutProject,
    ).toBe(false);
  });
});
