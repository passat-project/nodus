import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type CustomFieldDefinition } from '@nodus/contracts';

import { createProjectType, updateProjectType } from './project-type-form.js';

/**
 * Форма типа проекта (#631 Р10, #646): лок реестра атрибутов берётся ДО
 * чтения определений и записи привязок — конкурентное удаление атрибута
 * иначе даёт FK-ошибку (P2003 → 400) вместо 404/422. Слот-глобальная
 * переменная — 422 `PROJECT_TYPE_FORM_INVALID` с причиной `not_bindable`.
 */

const FIELD = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

function definition(id: string, isCompany = false): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name: 'Поле',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function makeDeps(definitions: CustomFieldDefinition[]) {
  const order: string[] = [];
  const types = {
    lockForms: vi.fn(async () => void order.push('lockForms')),
    nameTaken: vi.fn(async () => false),
    create: vi.fn(async () => ({
      id: 'type-1',
      name: 'Тендер',
      icon: 'folder',
      color: 'blue',
      form: { fields: [] },
      kindIds: null,
      archivedAt: null,
    })),
    findById: vi.fn(async () => ({
      id: 'type-1',
      name: 'Тендер',
      icon: 'folder',
      color: 'blue',
      form: { fields: [] },
      kindIds: null,
      archivedAt: null,
    })),
    update: vi.fn(async () => ({
      id: 'type-1',
      name: 'Тендер',
      icon: 'folder',
      color: 'blue',
      form: { fields: [] },
      kindIds: null,
      archivedAt: null,
    })),
  };
  const registry = {
    lockRegistry: vi.fn(async () => void order.push('lockRegistry')),
    definitions: vi.fn(async () => definitions),
    syncPlaceBindings: vi.fn(async () => undefined),
  };
  const nodeKinds = { activeByIds: vi.fn(async (ids: string[]) => ids) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  return { types, registry, nodeKinds, eventBus, order };
}

describe('форма типа проекта (#631, #646)', () => {
  it('создание: лок реестра ДО справочника типов; слоты пишутся привязками', async () => {
    const deps = makeDeps([definition(FIELD)]);
    await createProjectType(
      deps as never,
      {} as never,
      { name: 'Тендер', form: { fields: [{ fieldId: FIELD, state: 'required' }] } },
      'user-1',
    );
    expect(deps.order).toEqual(['lockRegistry', 'lockForms']);
    expect(deps.registry.syncPlaceBindings).toHaveBeenCalledWith(
      { kind: 'project_type', id: 'type-1' },
      [FIELD],
      [],
      expect.anything(),
    );
  });

  it('создание: слот глобальной переменной — 422 not_bindable', async () => {
    const deps = makeDeps([definition(COMPANY, true)]);
    await expect(
      createProjectType(
        deps as never,
        {} as never,
        { name: 'Тендер', form: { fields: [{ fieldId: COMPANY, state: 'optional' }] } },
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_TYPE_FORM_INVALID,
      details: { reason: 'not_bindable' },
    });
    expect(deps.types.create).not.toHaveBeenCalled();
  });

  it('правка: лок реестра берётся и без формы (дельта привязок не устареет)', async () => {
    const deps = makeDeps([definition(FIELD)]);
    await updateProjectType(deps as never, {} as never, 'type-1', { name: 'Новый' }, 'user-1');
    expect(deps.order).toEqual(['lockRegistry', 'lockForms']);
  });
});
