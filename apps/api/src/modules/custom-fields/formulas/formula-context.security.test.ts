import { describe, expect, it, vi } from 'vitest';
import type { FormulaNode } from '@nodus/contracts';

import { FormulaContextService } from './formula-context.service.js';
import { FormulaEngineProvider } from '../ports/formula-engine.provider.js';
import { FormulaValuesService } from './formula-values.service.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';
import type { FormulaRecordData, RecordValuesReader } from '../ports/record-values.port.js';
import type { DictionaryReader } from '../../dictionaries/ports/dictionary-reader.port.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';

/** Матрица безопасности Р7 (#632): источники формулы не выходят за своё
 *  дерево; конфиденциальные записи исключены ДЛЯ ВСЕХ (вердикт В1). */

function record(over: Partial<FormulaRecordData> & { id: string }): FormulaRecordData {
  return {
    kind: 'task',
    values: {},
    system: {},
    projectId: 'p1',
    parentId: null,
    nodeId: null,
    placeId: 't1',
    confidential: false,
    ...over,
  };
}

const definition = (over: Partial<FieldDefinitionRow> & { id: string; number: number }) =>
  ({
    type: 'task',
    name: 'Ссылка',
    hint: null,
    settings: {},
    defaultValue: null,
    reportIndexed: false,
    isCompany: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    bindings: [],
    companyValue: null,
    ...over,
  }) as FieldDefinitionRow;

const dictionaryReader = (): DictionaryReader => ({
  dictionaryRefs: vi.fn(async () => []),
  itemRefs: vi.fn(async () => []),
  activeItemRef: vi.fn(async () => null),
  itemsOf: vi.fn(async () => []),
  dictionaryIdByCode: vi.fn(async () => null),
  activeItemByCode: vi.fn(async () => null),
});

const refField = definition({ id: 'f-ref', number: 7, type: 'task' });
const snapshot = (rows: FieldDefinitionRow[] = [refField]): FormulaRegistrySnapshot => ({
  meta: { byNumber: new Map() },
  byNumber: new Map(rows.map((row) => [row.number, row])),
  byId: new Map(rows.map((row) => [row.id, row])),
  bindingFormulas: new Map(),
});

function service(reader: RecordValuesReader): FormulaContextService {
  return new FormulaContextService(
    reader,
    new FormulaEngineProvider(),
    new FormulaValuesService(dictionaryReader()),
  );
}

const source: FormulaNode = {
  kind: 'field',
  source: { kind: 'parent_task' },
  number: 3,
};

describe('FormulaContextService: видимость источников (Р7)', () => {
  it('конфиденциальный родитель — источник недоступен (null, не ошибка чтения)', async () => {
    const reader = {
      record: vi.fn(async (kind: string, id: string) => {
        if (id === 'task1') return record({ id: 'task1', parentId: 'parent1' });
        if (id === 'parent1') return record({ id: 'parent1', confidential: true });
        return null;
      }),
      subtasks: vi.fn(async () => []),
      relatedTasks: vi.fn(async () => []),
      nodeTasks: vi.fn(async () => []),
      projectNodes: vi.fn(async () => []),
    } as unknown as RecordValuesReader;
    const context = await service(reader).build({
      hostKind: 'task',
      hostId: 'task1',
      asts: [source],
      snapshot: snapshot(),
    });
    expect(context).not.toBeNull();
    expect(context!.resolver.single({ kind: 'parent_task' })).toBeNull();
  });

  it('родитель из другого проекта — источник недоступен', async () => {
    const reader = {
      record: vi.fn(async (kind: string, id: string) => {
        if (id === 'task1') return record({ id: 'task1', parentId: 'parent1' });
        if (id === 'parent1') return record({ id: 'parent1', projectId: 'p2' });
        return null;
      }),
      subtasks: vi.fn(async () => []),
      relatedTasks: vi.fn(async () => []),
      nodeTasks: vi.fn(async () => []),
      projectNodes: vi.fn(async () => []),
    } as unknown as RecordValuesReader;
    const context = await service(reader).build({
      hostKind: 'task',
      hostId: 'task1',
      asts: [source],
      snapshot: snapshot(),
    });
    expect(context!.resolver.single({ kind: 'parent_task' })).toBeNull();
  });

  it('ссылка на задачу чужого проекта — null; конфиденциальная цель — null', async () => {
    const ast: FormulaNode = {
      kind: 'field',
      source: { kind: 'ref_field', field: 7 },
      number: 2,
    };
    const reader = {
      record: vi.fn(async (kind: string, id: string) => {
        if (id === 'task1') return record({ id: 'task1', values: { 'f-ref': 'target1' } });
        if (id === 'target1') return record({ id: 'target1', projectId: 'p2' });
        return null;
      }),
      subtasks: vi.fn(async () => []),
      relatedTasks: vi.fn(async () => []),
      nodeTasks: vi.fn(async () => []),
      projectNodes: vi.fn(async () => []),
    } as unknown as RecordValuesReader;
    const context = await service(reader).build({
      hostKind: 'task',
      hostId: 'task1',
      asts: [ast],
      snapshot: snapshot(),
    });
    expect(context!.resolver.single({ kind: 'ref_field', field: 7 })).toBeNull();
  });

  it('ссылка на задачу своего проекта видна', async () => {
    const ast: FormulaNode = {
      kind: 'field',
      source: { kind: 'ref_field', field: 7 },
      number: 2,
    };
    const reader = {
      record: vi.fn(async (kind: string, id: string) => {
        if (id === 'task1') return record({ id: 'task1', values: { 'f-ref': 'target1' } });
        if (id === 'target1') return record({ id: 'target1' });
        return null;
      }),
      subtasks: vi.fn(async () => []),
      relatedTasks: vi.fn(async () => []),
      nodeTasks: vi.fn(async () => []),
      projectNodes: vi.fn(async () => []),
    } as unknown as RecordValuesReader;
    const context = await service(reader).build({
      hostKind: 'task',
      hostId: 'task1',
      asts: [ast],
      snapshot: snapshot(),
    });
    expect(context!.resolver.single({ kind: 'ref_field', field: 7 })).not.toBeNull();
  });

  it('письмо как цель ссылки не поддерживается V1 (O5)', async () => {
    const letterField = definition({ id: 'f-letter', number: 8, type: 'letter' });
    const ast: FormulaNode = {
      kind: 'field',
      source: { kind: 'ref_field', field: 8 },
      number: 2,
    };
    const reader = {
      record: vi.fn(async (kind: string, id: string) => {
        if (id === 'task1') return record({ id: 'task1', values: { 'f-letter': 'letter1' } });
        return record({ id: 'letter1' });
      }),
      subtasks: vi.fn(async () => []),
      relatedTasks: vi.fn(async () => []),
      nodeTasks: vi.fn(async () => []),
      projectNodes: vi.fn(async () => []),
    } as unknown as RecordValuesReader;
    const context = await service(reader).build({
      hostKind: 'task',
      hostId: 'task1',
      asts: [ast],
      snapshot: snapshot([refField, letterField]),
    });
    expect(context!.resolver.single({ kind: 'ref_field', field: 8 })).toBeNull();
  });

  it('компания — значения isCompany-атрибутов из реестра', async () => {
    const company = definition({
      id: 'f-company',
      number: 10,
      type: 'text',
      isCompany: true,
      companyValue: { value: 'ООО Нодус' },
    });
    const reader = {
      record: vi.fn(async () => record({ id: 'task1' })),
      subtasks: vi.fn(async () => []),
      relatedTasks: vi.fn(async () => []),
      nodeTasks: vi.fn(async () => []),
      projectNodes: vi.fn(async () => []),
    } as unknown as RecordValuesReader;
    const context = await service(reader).build({
      hostKind: 'task',
      hostId: 'task1',
      asts: [{ kind: 'field', source: { kind: 'company' }, number: 10 }],
      snapshot: snapshot([company]),
    });
    const companyRecord = context!.resolver.single({ kind: 'company' });
    expect(companyRecord?.value(10)).toBe('ООО Нодус');
  });
});
