import { describe, expect, it } from 'vitest';
import { buildDepKeys } from './formula-dep-keys.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';
import type { FormulaRecordData } from '../ports/record-values.port.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';

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

function definition(
  over: Partial<FieldDefinitionRow> & { id: string; number: number },
): FieldDefinitionRow {
  return {
    type: 'text',
    name: 'А',
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
  } as FieldDefinitionRow;
}

const snapshot = (rows: FieldDefinitionRow[]): FormulaRegistrySnapshot => ({
  meta: { byNumber: new Map() },
  byNumber: new Map(rows.map((row) => [row.number, row])),
  byId: new Map(rows.map((row) => [row.id, row])),
  bindingFormulas: new Map(),
});

describe('buildDepKeys: что должно измениться для пересчёта (Р4)', () => {
  it('значение своего атрибута — v:<kind>:<id>:<number>', () => {
    const keys = buildDepKeys({
      host: record({ id: 'task1' }),
      hostKind: 'task',
      project: null,
      nodes: new Map(),
      parent: null,
      related: new Map(),
      asts: [],
      deps: [{ kind: 'value', number: 5 }],
      snapshot: snapshot([]),
    });
    expect(keys).toEqual([{ key: 'v:task:task1:5', attrNumber: 5 }]);
  });

  it('компания — company:<number> с номером для поиска по атрибуту', () => {
    const keys = buildDepKeys({
      host: record({ id: 'task1' }),
      hostKind: 'task',
      project: null,
      nodes: new Map(),
      parent: null,
      related: new Map(),
      asts: [],
      deps: [{ kind: 'company', number: 9 }],
      snapshot: snapshot([]),
    });
    expect(keys).toEqual([{ key: 'company:9', attrNumber: 9 }]);
  });

  it('родитель — значение родителя + ключ смены родителя', () => {
    const keys = buildDepKeys({
      host: record({ id: 'task1', parentId: 'parent1' }),
      hostKind: 'task',
      project: null,
      nodes: new Map(),
      parent: record({ id: 'parent1' }),
      related: new Map(),
      asts: [],
      deps: [{ kind: 'parent', number: 3 }],
      snapshot: snapshot([]),
    });
    expect(keys.map((entry) => entry.key)).toEqual(['v:task:parent1:3', 'parent:task:task1']);
  });

  it('папка — дерево проекта + значения всех предков цепочки', () => {
    const nodes = new Map([
      ['n1', record({ kind: 'node', id: 'n1', parentId: null })],
      ['n2', record({ kind: 'node', id: 'n2', parentId: 'n1' })],
    ]);
    const keys = buildDepKeys({
      host: record({ id: 'task1', nodeId: 'n2' }),
      hostKind: 'task',
      project: record({ kind: 'project', id: 'p1' }),
      nodes,
      parent: null,
      related: new Map(),
      asts: [],
      deps: [{ kind: 'folder', number: 4, kindId: 'k1' }],
      snapshot: snapshot([]),
    });
    expect(keys.map((entry) => entry.key)).toEqual([
      'tree:project:p1',
      'v:node:n2:4',
      'v:node:n1:4',
    ]);
  });

  it('связи и подзадачи — композиционные ключи + значения связанных', () => {
    const keys = buildDepKeys({
      host: record({ id: 'task1' }),
      hostKind: 'task',
      project: null,
      nodes: new Map(),
      parent: null,
      related: new Map([
        ['relations:relates:both', [record({ id: 'other' })]],
        ['subtasks', [record({ id: 'child' })]],
      ]),
      asts: [],
      deps: [
        { kind: 'related', selector: 'relations', number: 2 },
        { kind: 'related', selector: 'subtasks', number: 2 },
      ],
      snapshot: snapshot([]),
    });
    expect(keys.map((entry) => entry.key).sort()).toEqual([
      'rel:task:task1',
      'subtasks:task:task1',
      'v:task:child:2',
      'v:task:other:2',
    ]);
  });

  it('ссылка — значение цели и номер атрибута-ссылки', () => {
    const refDefinition = definition({ id: 'f-ref', number: 7, type: 'task' });
    const keys = buildDepKeys({
      host: record({ id: 'task1', values: { 'f-ref': 'target1' } }),
      hostKind: 'task',
      project: null,
      nodes: new Map(),
      parent: null,
      related: new Map(),
      asts: [],
      deps: [{ kind: 'ref', refField: 7, number: 2 }],
      snapshot: snapshot([refDefinition]),
    });
    expect(keys).toEqual([{ key: 'v:task:target1:2', attrNumber: 2 }]);
  });

  it('пустой список зависимостей — пустые ключи', () => {
    expect(
      buildDepKeys({
        host: record({ id: 'task1' }),
        hostKind: 'task',
        project: null,
        nodes: new Map(),
        parent: null,
        related: new Map(),
        asts: [],
        deps: [],
        snapshot: snapshot([]),
      }),
    ).toEqual([]);
  });
});
