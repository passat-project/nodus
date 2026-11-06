import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldValue } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import { DefinitionsService } from './definitions.service.js';
import type { FieldDefinitionRow } from './definition.mapper.js';
import type { CustomFieldIssue } from '../values/value-validator.js';

/**
 * Глобальные переменные портала (#631, Р7): значение одно на компанию
 * (upsert по PK-определению), не-глобальному — 422, null — очистка,
 * грамматика — тип определения, изменение — событие companyValue.
 */

const ROW: FieldDefinitionRow = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 7,
  type: 'text',
  name: 'Ставка НДС',
  hint: null,
  settings: {},
  defaultValue: null,
  reportIndexed: false,
  isCompany: true,
  sortOrder: 0,
  createdAt: new Date('2026-11-06T00:00:00.000Z'),
  updatedAt: new Date('2026-11-06T00:00:00.000Z'),
  bindings: [],
  companyValue: null,
};

function makeService() {
  const definitions = {
    list: vi.fn(async (): Promise<FieldDefinitionRow[]> => [ROW]),
    findById: vi.fn(async (): Promise<FieldDefinitionRow | null> => ROW),
    countAll: vi.fn(async () => 0),
    findByName: vi.fn(async () => null),
    maxSortOrder: vi.fn(async () => 0),
    nextNumber: vi.fn(async () => 42),
    create: vi.fn(async (data: object) => ({ ...ROW, ...data })),
    update: vi.fn(async (_id: string, data: object) => ({ ...ROW, ...data })),
    remove: vi.fn(async () => undefined),
    bindTarget: vi.fn(async () => undefined),
    unbindTarget: vi.fn(async () => true),
    replaceTargets: vi.fn(async () => undefined),
    syncTargets: vi.fn(async () => undefined),
    putCompanyValue: vi.fn(async () => undefined),
    applyOrder: vi.fn(async () => undefined),
    lockRegistry: vi.fn(async () => undefined),
  };
  const mapper = { toDtos: vi.fn(async () => []), toDto: vi.fn(async () => ({ id: ROW.id })) };
  const validator = { validate: vi.fn(async (): Promise<CustomFieldIssue[]> => []) };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const dictionaries = { dictionaryRefs: vi.fn(async () => []), itemRefs: vi.fn(async () => []) };
  const workflows = {
    workflowsUsingField: vi.fn(async () => []),
    creationFormsUsingField: vi.fn(async () => []),
  };
  const catalog = { typeRefs: vi.fn(async () => []) };
  const targets = { projectTypes: vi.fn(async () => []), nodeKinds: vi.fn(async () => []) };
  const usageReader = { usage: vi.fn(async () => ({})) };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new DefinitionsService(
    definitions as never,
    mapper as never,
    validator as never,
    txRunner as never,
    eventBus as never,
    dictionaries as never,
    workflows as never,
    catalog as never,
    targets as never,
    usageReader as never,
    logger as never,
  );
  return { service, definitions, validator, eventBus };
}

describe('DefinitionsService.setCompanyValue (#631, Р7)', () => {
  it('не-глобальному — 422, строка значения не пишется', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue({ ...ROW, isCompany: false });
    await expect(
      service.setCompanyValue(ROW.id, 'значение' as CustomFieldValue, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(definitions.putCompanyValue).not.toHaveBeenCalled();
  });

  it('значение глобальной переменной: upsert по определению + событие companyValue', async () => {
    const { service, definitions, eventBus } = makeService();
    const result = await service.setCompanyValue(ROW.id, '20%' as CustomFieldValue, 'actor-1');
    expect(result).toEqual({ id: ROW.id });
    expect(definitions.putCompanyValue).toHaveBeenCalledWith(
      ROW.id,
      '20%',
      'actor-1',
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'updated', fields: ['companyValue'] }),
      expect.anything(),
    );
  });

  it('PUT×2 — одна строка на компанию: оба раза тот же upsert PK-определения', async () => {
    const { service, definitions } = makeService();
    await service.setCompanyValue(ROW.id, '20%' as CustomFieldValue, 'actor-1');
    await service.setCompanyValue(ROW.id, '25%' as CustomFieldValue, 'actor-1');
    // «Одна строка» — upsert репозитория (PK = определение); сервис обязан
    // оба раза делегировать одному и тому же putCompanyValue, без ветки create.
    expect(definitions.putCompanyValue).toHaveBeenCalledTimes(2);
    expect(definitions.putCompanyValue).toHaveBeenNthCalledWith(
      1,
      ROW.id,
      '20%',
      'actor-1',
      expect.anything(),
    );
    expect(definitions.putCompanyValue).toHaveBeenNthCalledWith(
      2,
      ROW.id,
      '25%',
      'actor-1',
      expect.anything(),
    );
  });

  it('null — очистка без валидации значения', async () => {
    const { service, definitions, validator } = makeService();
    await service.setCompanyValue(ROW.id, null, 'actor-1');
    expect(definitions.putCompanyValue).toHaveBeenCalledWith(
      ROW.id,
      null,
      'actor-1',
      expect.anything(),
    );
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('значение мимо грамматики типа — 422 CUSTOM_FIELD_VALUE_INVALID', async () => {
    const { service, validator, definitions } = makeService();
    definitions.findById.mockResolvedValue({ ...ROW, type: 'number' });
    validator.validate.mockResolvedValue([
      { fieldId: ROW.id, reason: 'invalid', message: 'Value does not match field type' },
    ]);
    await expect(
      service.setCompanyValue(ROW.id, 'не число' as CustomFieldValue, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID });
    expect(definitions.putCompanyValue).not.toHaveBeenCalled();
  });
});
