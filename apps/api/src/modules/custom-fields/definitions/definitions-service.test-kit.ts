import { vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import { DefinitionsService } from './definitions.service.js';
import type { FieldDefinitionRow } from './definition.mapper.js';
import type { CustomFieldIssue } from '../values/value-validator.js';

/**
 * Общий набор моков сервиса реестра атрибутов (#631): строка определения,
 * DTO и сервис на портах-моках. Разнесён из definitions.service.test.ts в
 * локальный helper ради лимита строк файла (I5); поведение моков прежнее.
 */

const NOW = new Date('2026-11-06T00:00:00.000Z');

const row = (overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  number: 7,
  type: 'text',
  name: '№ накладной',
  hint: null,
  settings: {},
  defaultValue: null,
  reportIndexed: false,
  isCompany: false,
  sortOrder: 0,
  createdAt: NOW,
  updatedAt: NOW,
  bindings: [],
  companyValue: null,
  ...overrides,
});

const ROW = row();

const DTO = {
  id: ROW.id,
  number: 7,
  type: 'text',
  name: ROW.name,
} as CustomFieldDefinition;

function makeService() {
  const definitions = {
    list: vi.fn(async (): Promise<FieldDefinitionRow[]> => [ROW]),
    findById: vi.fn(async (): Promise<FieldDefinitionRow | null> => ROW),
    countAll: vi.fn(async () => 0),
    findByName: vi.fn<
      (name: string, exceptId: string | null) => Promise<{ id: string; name: string } | null>
    >(async () => null),
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
  const mapper = { toDtos: vi.fn(async () => [DTO]), toDto: vi.fn(async () => DTO) };
  const validator = { validate: vi.fn(async (): Promise<CustomFieldIssue[]> => []) };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const dictionaries = {
    dictionaryRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, code: 'currency', name: 'Валюты', isSystem: true })),
    ),
    itemRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, dictionaryId: 'dict-1', name: 'Рубль', isActive: true, color: null })),
    ),
  };
  const workflows = {
    workflowsUsingField: vi.fn(async () => [{ id: 'w-1', name: 'Переработка' }]),
    creationFormsUsingField: vi.fn(async () => []),
  };
  const catalog = {
    typeRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, code: `custom-${id}`, name: 'Тип', category: 'task' })),
    ),
  };
  const targets = {
    projectTypes: vi.fn(async () => [{ id: 'pt-1', name: 'Тендер', archived: false }]),
    nodeKinds: vi.fn(async () => [{ id: 'nk-1', name: 'Комплект', archived: false }]),
  };
  const usageReader = { usage: vi.fn(async () => ({})) };
  const formCleaner = { removeFieldFromForm: vi.fn(async () => undefined) };
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
    formCleaner as never,
    usageReader as never,
    logger as never,
  );
  return {
    service,
    definitions,
    mapper,
    validator,
    eventBus,
    dictionaries,
    workflows,
    catalog,
    targets,
    formCleaner,
  };
}

export { DTO, makeService, NOW, ROW, row };
