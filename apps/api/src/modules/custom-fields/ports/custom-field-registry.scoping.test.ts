import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import { CustomFieldRegistryProvider } from './custom-field-registry.provider.js';

/**
 * Скоупинг реестра `fieldIds` и пачка ссылок `refsMany` (#556, Р4): форма
 * вида папки — единственная привязка атрибутов, поэтому реестр фильтруется
 * множеством id; `typeId` и `fieldIds` вместе — ошибка программиста; ссылки
 * среза структуры считаются одной пачкой.
 */

const definition = (
  overrides: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'id' | 'type'>,
): CustomFieldDefinition =>
  ({
    scope: 'node',
    name: 'Поле',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    hidden: false,
    sortOrder: 0,
    typeIds: [],
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }) as CustomFieldDefinition;

const ACTOR = { id: 'author-1', permissions: [] };

function makeRegistry(definitions: CustomFieldDefinition[]) {
  const repository = { list: vi.fn(async () => []) };
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

describe('CustomFieldRegistry: скоупинг fieldIds (#556)', () => {
  it('умолчания считаются только у атрибутов формы вида', async () => {
    const definitions = [
      definition({
        id: 'f-in-form',
        type: 'text',
        defaultValue: { kind: 'static', value: 'своё' },
      }),
      definition({
        id: 'f-not-in-form',
        type: 'text',
        defaultValue: { kind: 'static', value: 'чужое' },
      }),
    ];
    const { registry, defaults } = makeRegistry(definitions);
    const values = await registry.prepareCreate('node', {
      input: {},
      authorId: ACTOR.id,
      actor: ACTOR,
      fieldIds: ['f-in-form'],
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
      definition({ id: 'f-in-form', type: 'text' }),
      definition({ id: 'f-other', type: 'text' }),
    ]);
    await expect(
      registry.prepareCreate('node', {
        input: { 'f-other': 'v' },
        authorId: ACTOR.id,
        actor: ACTOR,
        fieldIds: ['f-in-form'],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      details: { issues: [{ fieldId: 'f-other', reason: 'not_in_type' }] },
    });
  });

  it('typeId и fieldIds вместе — ошибка программиста, а не пользователя', async () => {
    const { registry } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    await expect(
      registry.definitions('node', { typeId: 't-1', fieldIds: ['f-a'] }),
    ).rejects.toThrow('typeId and fieldIds are exclusive');
  });
});

describe('CustomFieldRegistry.refsMany (#556, Р4)', () => {
  it('одна пачка гидратора на список карт значений', async () => {
    const { registry, hydrator } = makeRegistry([definition({ id: 'f-a', type: 'user' })]);
    hydrator.hydrateMany.mockResolvedValue([
      { kind: 'user', id: 'u-1', name: 'Иван', avatarUrl: null, archived: false },
    ]);
    const refs = await registry.refsMany('node', [{}, { 'f-a': 'u-1' }, { 'f-a': 'u-1' }], ACTOR);
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
    expect(await registry.refsMany('node', [{}, {}], ACTOR)).toEqual([]);
    expect(hydrator.hydrateMany).not.toHaveBeenCalled();
  });

  it('refs делегирует пачке', async () => {
    const { registry, hydrator } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    await registry.refs('task', { 'f-a': 'v' }, ACTOR);
    expect(hydrator.hydrateMany).toHaveBeenCalledWith(
      expect.anything(),
      [{ 'f-a': 'v' }],
      ACTOR,
      undefined,
    );
  });
});
