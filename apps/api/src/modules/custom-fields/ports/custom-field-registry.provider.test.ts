import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import type { CustomFieldIssue } from '../values/value-validator.js';
import { CustomFieldRegistryProvider, invalidValues } from './custom-field-registry.provider.js';

/**
 * Порт реестра (#431/#631, Р2/Р5): единственная точка динамической
 * валидации. Проверяются: слияние умолчаний с вводом (ввод важнее),
 * проверка только изменённых значений, `null` удаляет ключ, стабильное
 * сравнение JSONB-карт, скопинг по месту сущности (target), синхронизация
 * слотов форм мест.
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
const BYN = '99999999-9999-4999-8999-999999999999';

function makeRegistry(definitions: CustomFieldDefinition[]) {
  const repository = {
    list: vi.fn(async () => []),
    syncTargets: vi.fn(async () => undefined),
  };
  const mapper = { toDtos: vi.fn(async () => definitions), toDto: vi.fn() };
  const validator = { validate: vi.fn(async (): Promise<CustomFieldIssue[]> => []) };
  const defaults = {
    resolve: vi.fn<(defs: readonly CustomFieldDefinition[]) => Promise<Record<string, unknown>>>(
      async () => ({}),
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
  return { registry, repository, validator, defaults, mapper, hydrator };
}

describe('CustomFieldRegistry.prepareCreate (#431/#631, Р5)', () => {
  it('умолчания + ввод: явное значение важнее умолчания', async () => {
    const definitions = [
      definition({
        id: 'f-a',
        type: 'text',
        defaultValue: { kind: 'static', value: 'из умолчания' },
      }),
      definition({ id: 'f-b', type: 'text', defaultValue: { kind: 'static', value: 'второе' } }),
    ];
    const { registry, defaults } = makeRegistry(definitions);
    defaults.resolve.mockResolvedValue({ 'f-a': 'из умолчания', 'f-b': 'второе' });
    const values = await registry.prepareCreate({
      input: { 'f-a': 'явное' },
      authorId: 'author-1',
      actor: ACTOR,
    });
    expect(values).toEqual({ 'f-a': 'явное', 'f-b': 'второе' });
  });

  it('умолчание с недействительной ссылкой отбрасывается, создание продолжается', async () => {
    const definitions = [definition({ id: 'f-a', type: 'user', defaultValue: null })];
    const { registry, defaults, validator } = makeRegistry(definitions);
    defaults.resolve.mockResolvedValue({ 'f-a': 'bad-user' });
    // Первый вызов — умолчания (есть отказ), второй — ввод (чисто).
    validator.validate.mockResolvedValueOnce([
      { fieldId: 'f-a', reason: 'inactive', message: 'User is deactivated' },
    ]);
    const values = await registry.prepareCreate({
      input: {},
      authorId: 'author-1',
      actor: ACTOR,
    });
    expect(values).toEqual({});
  });

  it('пустой реестр: любой ввод — unknown (422)', async () => {
    const { registry } = makeRegistry([]);
    await expect(
      registry.prepareCreate({ input: { 'f-x': 'v' }, authorId: 'author-1', actor: ACTOR }),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      details: { issues: [{ fieldId: 'f-x', reason: 'unknown' }] },
    });
  });

  it('умолчания — только атрибутов места (target, #631 Р3)', async () => {
    const definitions = [
      definition({
        id: 'f-bound',
        type: 'text',
        bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
        defaultValue: { kind: 'static', value: 'своё' },
      }),
      definition({
        id: 'f-other',
        type: 'text',
        bindings: { processTypeIds: ['t-2'], projectTypeIds: [], nodeKindIds: [] },
        defaultValue: { kind: 'static', value: 'чужое' },
      }),
    ];
    const { registry, defaults } = makeRegistry(definitions);
    defaults.resolve.mockImplementation(async (defs) =>
      Object.fromEntries(
        defs
          .filter((entry) => entry.defaultValue?.kind === 'static')
          .map((entry) => [
            entry.id,
            (entry.defaultValue as { kind: 'static'; value: unknown }).value,
          ]),
      ),
    );
    const values = await registry.prepareCreate({
      input: {},
      authorId: 'author-1',
      actor: ACTOR,
      target: { kind: 'process_type', id: 't-1' },
    });
    expect(values).toEqual({ 'f-bound': 'своё' });
    expect(defaults.resolve).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'f-bound' })],
      'author-1',
      undefined,
    );
  });

  it('значение существующего, но непривязанного к месту атрибута — not_in_type (422)', async () => {
    const { registry } = makeRegistry([
      definition({
        id: 'f-bound',
        type: 'text',
        bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
      }),
      definition({
        id: 'f-other',
        type: 'text',
        bindings: { processTypeIds: ['t-2'], projectTypeIds: [], nodeKindIds: [] },
      }),
    ]);
    await expect(
      registry.prepareCreate({
        input: { 'f-other': 'v' },
        authorId: 'author-1',
        actor: ACTOR,
        target: { kind: 'process_type', id: 't-1' },
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      details: { issues: [{ fieldId: 'f-other', reason: 'not_in_type' }] },
    });
  });
});

describe('CustomFieldRegistry.prepareUpdate (#431, Р1/Р2)', () => {
  it('null удаляет ключ, незаполненное не хранится', async () => {
    const { registry } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    const { next, changes } = await registry.prepareUpdate({
      actor: ACTOR,
      current: { 'f-a': 'старое', 'f-b': 'остаётся' },
      patch: { 'f-a': null },
    });
    expect(next).toEqual({ 'f-b': 'остаётся' });
    expect(changes).toEqual([{ fieldId: 'f-a', from: 'старое', to: null }]);
  });

  it('проверяются только изменённые значения', async () => {
    const { registry, validator } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    await registry.prepareUpdate({
      actor: ACTOR,
      current: { 'f-a': 'то же' },
      patch: { 'f-a': 'то же' },
    });
    expect(validator.validate).toHaveBeenCalledWith(expect.anything(), {}, undefined, ACTOR);
  });

  it('деньги сравниваются по содержимому: порядок ключей JSONB не важен', async () => {
    const { registry } = makeRegistry([
      definition({ id: 'f-money', type: 'money', settings: { currencyId: BYN } }),
    ]);
    const { next, changes } = await registry.prepareUpdate({
      actor: ACTOR,
      current: { 'f-money': { amount: 5, currencyId: BYN } },
      patch: { 'f-money': { currencyId: BYN, amount: 5 } as never },
    });
    expect(next).toEqual({ 'f-money': { amount: 5, currencyId: BYN } });
    expect(changes).toEqual([]);
  });

  it('ошибка валидатора превращается в 422 с перечнем полей', async () => {
    const { registry, validator } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    validator.validate.mockResolvedValue([
      { fieldId: 'f-a', reason: 'invalid', message: 'Value does not match field type' },
    ]);
    await expect(
      registry.prepareUpdate({ actor: ACTOR, current: {}, patch: { 'f-a': 'x' } }),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID });
  });

  it('пустой патч не трогает значения и не падает', async () => {
    const { registry } = makeRegistry([definition({ id: 'f-a', type: 'text' })]);
    const result = await registry.prepareUpdate({
      actor: ACTOR,
      current: { 'f-a': 'x' },
      patch: {},
    });
    expect(result).toEqual({ next: { 'f-a': 'x' }, changes: [] });
  });

  it('очистка непривязанного разрешена, запись — not_in_type (#631, Р8/Р3)', async () => {
    const definitions = [
      definition({
        id: 'f-bound',
        type: 'text',
        bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
      }),
      definition({
        id: 'f-other',
        type: 'text',
        bindings: { processTypeIds: ['t-2'], projectTypeIds: [], nodeKindIds: [] },
      }),
    ];
    const { registry } = makeRegistry(definitions);
    const cleared = await registry.prepareUpdate({
      actor: ACTOR,
      current: { 'f-other': 'старое' },
      patch: { 'f-other': null },
      target: { kind: 'process_type', id: 't-1' },
    });
    expect(cleared.next).toEqual({});
    await expect(
      registry.prepareUpdate({
        actor: ACTOR,
        current: {},
        patch: { 'f-other': 'новое' },
        target: { kind: 'process_type', id: 't-1' },
      }),
    ).rejects.toMatchObject({
      details: { issues: [{ fieldId: 'f-other', reason: 'not_in_type' }] },
    });
  });
});

describe('CustomFieldRegistry.syncPlaceBindings (#631, Р10)', () => {
  it('process_type не имеет форм-слотов — ошибка программиста', async () => {
    const { registry, repository } = makeRegistry([]);
    await expect(
      registry.syncPlaceBindings({ kind: 'process_type', id: 't-1' }, ['f-a']),
    ).rejects.toThrow('process_type has no form slots');
    expect(repository.syncTargets).not.toHaveBeenCalled();
  });

  it('project_type/node_kind: привязки места — под точный набор слотов', async () => {
    const { registry, repository } = makeRegistry([]);
    await registry.syncPlaceBindings({ kind: 'project_type', id: 'pt-1' }, ['f-a', 'f-b']);
    await registry.syncPlaceBindings({ kind: 'node_kind', id: 'nk-1' }, []);
    expect(repository.syncTargets).toHaveBeenCalledWith(
      'project_type',
      'pt-1',
      ['f-a', 'f-b'],
      undefined,
    );
    expect(repository.syncTargets).toHaveBeenCalledWith('node_kind', 'nk-1', [], undefined);
  });
});

describe('invalidValues (#431, Р2)', () => {
  it('доменная ошибка 422 с перечнем полей', () => {
    const error = invalidValues([{ fieldId: 'f-a', reason: 'unknown', message: 'Unknown' }]);
    expect(error.code).toBe(ErrorCode.CUSTOM_FIELD_VALUE_INVALID);
    expect(error.details).toEqual({
      issues: [{ fieldId: 'f-a', reason: 'unknown', message: 'Unknown' }],
    });
  });
});
