import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import { CustomFieldRegistryProvider } from './custom-field-registry.provider.js';

/**
 * Скоупинг реестра по месту сущности и пачка ссылок `refsMany` (#631, Р3;
 * #556, Р4): реестр фильтруется строкой field_bindings (тип процесса, тип
 * проекта, вид папки); умолчания и ввод — только атрибутов места; ссылки
 * среза структуры считаются одной пачкой.
 */

const definition = (
  overrides: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'id' | 'type'>,
): CustomFieldDefinition =>
  ({
    number: 1,
    name: 'Поле',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    ...overrides,
  }) as CustomFieldDefinition;

const ACTOR = { id: 'author-1', permissions: [] };

function makeRegistry(definitions: CustomFieldDefinition[]) {
  const repository = {
    list: vi.fn(async () => []),
    syncTargets: vi.fn(async () => undefined),
  };
  const mapper = { toDtos: vi.fn(async () => definitions), toDto: vi.fn() };
  const validator = { validate: vi.fn(async () => []) };
  const defaults = {
    resolve: vi.fn(async (defs: readonly CustomFieldDefinition[]) =>
      Object.fromEntries(
        defs
          .filter((entry) => entry.defaultValue?.kind === 'static')
          .map((entry) => [
            entry.id,
            (entry.defaultValue as { kind: 'static'; value: unknown }).value,
          ]),
      ),
    ),
  };
  const hydrator = {
    hydrate: vi.fn(async (): Promise<unknown[]> => []),
    hydrateMany: vi.fn(async (): Promise<unknown[]> => []),
  };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const registry = new CustomFieldRegistryProvider(
    repository as never,
    mapper as never,
    validator as never,
    defaults as never,
    hydrator as never,
    logger as never,
  );
  return { registry, defaults, hydrator };
}

describe('CustomFieldRegistry: реестр места (#631, Р3)', () => {
  it('definitions(target): только атрибуты места; без target — весь реестр', async () => {
    const definitions = [
      definition({
        id: 'f-proc',
        type: 'text',
        bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
      }),
      definition({
        id: 'f-proj',
        type: 'text',
        bindings: { processTypeIds: [], projectTypeIds: ['pt-1'], nodeKindIds: [] },
      }),
      definition({
        id: 'f-kind',
        type: 'text',
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: ['nk-1'] },
      }),
      definition({ id: 'f-free', type: 'text' }),
    ];
    const { registry } = makeRegistry(definitions);
    const ids = (list: CustomFieldDefinition[]) => list.map((entry) => entry.id);
    expect(
      ids(await registry.definitions({ target: { kind: 'process_type', id: 't-1' } })),
    ).toEqual(['f-proc']);
    expect(
      ids(await registry.definitions({ target: { kind: 'project_type', id: 'pt-1' } })),
    ).toEqual(['f-proj']);
    expect(ids(await registry.definitions({ target: { kind: 'node_kind', id: 'nk-1' } }))).toEqual([
      'f-kind',
    ]);
    // Чужой тип процесса — пусто: место не совпало.
    expect(await registry.definitions({ target: { kind: 'process_type', id: 't-2' } })).toEqual([]);
    expect(ids(await registry.definitions())).toEqual(['f-proc', 'f-proj', 'f-kind', 'f-free']);
  });

  it('умолчания при создании папки — только атрибуты формы вида', async () => {
    const definitions = [
      definition({
        id: 'f-in-form',
        type: 'text',
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: ['nk-1'] },
        defaultValue: { kind: 'static', value: 'своё' },
      }),
      definition({
        id: 'f-not-in-form',
        type: 'text',
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: ['nk-2'] },
        defaultValue: { kind: 'static', value: 'чужое' },
      }),
    ];
    const { registry, defaults } = makeRegistry(definitions);
    const values = await registry.prepareCreate({
      input: {},
      authorId: ACTOR.id,
      actor: ACTOR,
      target: { kind: 'node_kind', id: 'nk-1' },
    });
    expect(values).toEqual({ 'f-in-form': 'своё' });
    expect(defaults.resolve).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'f-in-form' })],
      ACTOR.id,
      undefined,
    );
  });

  it('значение существующего, но не входящего в форму вида — not_in_type', async () => {
    const { registry } = makeRegistry([
      definition({
        id: 'f-in-form',
        type: 'text',
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: ['nk-1'] },
      }),
      definition({
        id: 'f-other',
        type: 'text',
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: ['nk-2'] },
      }),
    ]);
    await expect(
      registry.prepareCreate({
        input: { 'f-other': 'v' },
        authorId: ACTOR.id,
        actor: ACTOR,
        target: { kind: 'node_kind', id: 'nk-1' },
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      details: { issues: [{ fieldId: 'f-other', reason: 'not_in_type' }] },
    });
  });
});

describe('CustomFieldRegistry.refsMany (#556, Р4)', () => {
  it('одна пачка гидратора на список карт значений', async () => {
    const { registry, hydrator } = makeRegistry([definition({ id: 'f-a', type: 'user' })]);
    hydrator.hydrateMany.mockResolvedValue([
      { kind: 'user', id: 'u-1', name: 'Иван', avatarUrl: null, archived: false },
    ]);
    const refs = await registry.refsMany([{}, { 'f-a': 'u-1' }, { 'f-a': 'u-1' }], ACTOR);
    expect(hydrator.hydrateMany).toHaveBeenCalledTimes(1);
    expect(hydrator.hydrateMany).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'f-a' })],
      [{}, { 'f-a': 'u-1' }, { 'f-a': 'u-1' }],
      ACTOR,
      undefined,
    );
    expect(refs).toHaveLength(1);
  });

  it('все карты пусты — гидратор не зовётся', async () => {
    const { registry, hydrator } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    expect(await registry.refsMany([{}, {}], ACTOR)).toEqual([]);
    expect(hydrator.hydrateMany).not.toHaveBeenCalled();
  });

  it('refs делегирует пачке', async () => {
    const { registry, hydrator } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    await registry.refs({ 'f-a': 'v' }, ACTOR);
    expect(hydrator.hydrateMany).toHaveBeenCalledWith(
      expect.anything(),
      [{ 'f-a': 'v' }],
      ACTOR,
      undefined,
    );
  });
});
