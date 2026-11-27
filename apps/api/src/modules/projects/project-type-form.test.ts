import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  PROJECT_EVENTS,
  type CustomFieldDefinition,
  type ProjectType,
} from '@nodus/contracts';

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
  const row = (): ProjectType => ({
    id: 'type-1',
    name: 'Тендер',
    icon: 'flag',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
  });
  const types = {
    lockForms: vi.fn(async () => void order.push('lockForms')),
    nameTaken: vi.fn(async () => false),
    create: vi.fn<(tx: unknown, data: Record<string, unknown>) => Promise<ProjectType>>(async () =>
      row(),
    ),
    findById: vi.fn<(id: string, tx?: unknown) => Promise<ProjectType | null>>(async () => row()),
    update: vi.fn(async (): Promise<ProjectType | null> => row()),
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

describe('создание типа проекта копией (#857)', () => {
  const source = (overrides: Partial<ProjectType>): ProjectType => ({
    id: 'source-1',
    name: 'Основа',
    icon: 'flag',
    color: 'blue',
    form: { fields: [{ fieldId: FIELD, state: 'required' }] },
    kindIds: ['kind-a', 'kind-b'],
    archivedAt: null,
    ...overrides,
  });

  it('форма и kindIds — глубокая копия основы; привязки и оба события', async () => {
    const deps = makeDeps([definition(FIELD)]);
    const base = source({});
    deps.types.findById.mockResolvedValue(base);
    await createProjectType(
      deps as never,
      {} as never,
      { name: 'Копия', base: { kind: 'copy', typeId: 'source-1' } },
      'user-1',
    );
    const input = deps.types.create.mock.calls[0]![1]!;
    expect(input).toMatchObject({
      name: 'Копия',
      form: { fields: [{ fieldId: FIELD, state: 'required' }] },
      kindIds: ['kind-a', 'kind-b'],
    });
    // Глубокая копия: слоты основы не разделяются с новым типом.
    expect(input.form).not.toBe(base.form);
    expect(input.kindIds).not.toBe(base.kindIds);
    expect(deps.registry.syncPlaceBindings).toHaveBeenCalledWith(
      { kind: 'project_type', id: 'type-1' },
      [FIELD],
      [],
      {},
    );
    expect(deps.eventBus.emit).toHaveBeenCalledTimes(2);
    expect(deps.eventBus.emit).toHaveBeenNthCalledWith(
      1,
      {},
      PROJECT_EVENTS.TYPE_CHANGED,
      // Копия несёт sourceTypeId: подписчик модели связей (#857) не
      // расчищает ей список подключённых типов — наследует type_copied.
      {
        typeId: 'type-1',
        change: 'created',
        fields: ['name', 'form', 'kindIds'],
        sourceTypeId: 'source-1',
      },
      { actorId: 'user-1', aggregateType: 'project_type', aggregateId: 'type-1' },
    );
    expect(deps.eventBus.emit).toHaveBeenNthCalledWith(
      2,
      {},
      PROJECT_EVENTS.TYPE_COPIED,
      { typeId: 'type-1', sourceTypeId: 'source-1' },
      { actorId: 'user-1', aggregateType: 'project_type', aggregateId: 'type-1' },
    );
  });

  it('kindIds null основы — «все папки» у копии; simple не пишет kindIds вовсе', async () => {
    const copy = makeDeps([definition(FIELD)]);
    copy.types.findById.mockResolvedValue(source({ kindIds: null }));
    await createProjectType(
      copy as never,
      {} as never,
      { name: 'Копия', base: { kind: 'copy', typeId: 'source-1' } },
      'user-1',
    );
    expect(copy.types.create.mock.calls[0]![1]).toMatchObject({ kindIds: null });

    const simple = makeDeps([]);
    await createProjectType(simple as never, {} as never, { name: 'Простой' }, 'user-1');
    expect(simple.types.create.mock.calls[0]![1]).not.toHaveProperty('kindIds');
    expect(simple.eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('архивная или отсутствующая основа — 404, создания нет', async () => {
    const deps = makeDeps([]);
    deps.types.findById.mockResolvedValue(source({ archivedAt: '2026-11-20T00:00:00.000Z' }));
    await expect(
      createProjectType(
        deps as never,
        {} as never,
        { name: 'Копия', base: { kind: 'copy', typeId: 'source-1' } },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    deps.types.findById.mockResolvedValue(null);
    await expect(
      createProjectType(
        deps as never,
        {} as never,
        { name: 'Копия', base: { kind: 'copy', typeId: 'source-1' } },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(deps.types.create).not.toHaveBeenCalled();
  });
});
