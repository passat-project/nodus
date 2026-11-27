import { describe, expect, it } from 'vitest';

import { customFieldKey } from '../custom-fields/custom-field-key.js';
import {
  CSV_EXPORT,
  LIST_SYSTEM_FIELDS_BY_ENTITY,
  LIST_VIEW_LIMITS,
  createListExportBodySchema,
  createSavedViewBodySchema,
  listFieldSchema,
  listFilterSchema,
  listGroupBucketSchema,
  listQueryExtSchema,
  listSystemFieldSchema,
  listTotalSchema,
  savedViewSchema,
} from './list-view.schemas.js';

const hours = customFieldKey('00000000-0000-4000-8000-000000000001');

describe('контракт списков #435', () => {
  it('карта системных полей покрывает весь словарь и только свою сущность', () => {
    const dictionary = new Set(listSystemFieldSchema.options);
    for (const fields of Object.values(LIST_SYSTEM_FIELDS_BY_ENTITY)) {
      for (const field of fields) expect(dictionary.has(field)).toBe(true);
    }
    expect(LIST_SYSTEM_FIELDS_BY_ENTITY.task).not.toContain('regNumber');
    expect(LIST_SYSTEM_FIELDS_BY_ENTITY.letter).not.toContain('folder');
    expect(LIST_SYSTEM_FIELDS_BY_ENTITY.folder).not.toContain('stage');
  });

  it('поле списка — системный ключ или атрибут cf.<uuid>; мусор отвергается', () => {
    expect(listFieldSchema.parse('deadline')).toBe('deadline');
    expect(listFieldSchema.parse(hours)).toBe(hours);
    expect(listFieldSchema.safeParse('cf.not-a-uuid').success).toBe(false);
    expect(listFieldSchema.safeParse('произвольная строка').success).toBe(false);
  });

  it('фильтр — конъюнкция предикатов общей выборки #635, лимит 10', () => {
    const parsed = listFilterSchema.parse([
      { kind: 'type_is', typeId: '00000000-0000-4000-8000-000000000010' },
      { kind: 'field', field: hours, op: 'gte', value: 8 },
      { kind: 'system_state', state: 'closed' },
    ]);
    expect(parsed).toHaveLength(3);
    const tooMany = Array.from({ length: LIST_VIEW_LIMITS.predicates + 1 }, () => ({
      kind: 'result_issued',
    }));
    expect(listFilterSchema.safeParse(tooMany).success).toBe(false);
  });

  it('запрос списка: сортировка/группировка/итоги с лимитами', () => {
    const q = listQueryExtSchema.parse({
      filter: [{ kind: 'field', field: hours, op: 'filled' }],
      sort: [{ field: hours, dir: 'desc' }],
      group: { field: 'assignee' },
      totals: [{ fn: 'count' }, { fn: 'sum', field: hours }],
    });
    expect(q.sort).toHaveLength(1);
    expect(q.totals).toHaveLength(2);
    expect(
      listQueryExtSchema.safeParse({
        sort: Array.from({ length: 3 }, () => ({ field: 'title', dir: 'asc' })),
      }).success,
    ).toBe(false);
    expect(listTotalSchema.safeParse({ fn: 'sum' }).success).toBe(false);
  });

  it('defaults: пустой фильтр и сортировка подставляются', () => {
    const q = listQueryExtSchema.parse({});
    expect(q.filter).toEqual([]);
    expect(q.sort).toEqual([]);
    expect(q.totals).toEqual([]);
  });

  it('сохранённый вид: уровни, рамки и настройка', () => {
    const view = savedViewSchema.parse({
      id: '00000000-0000-4000-8000-000000000100',
      name: 'Переработки',
      entity: 'task',
      scope: { kind: 'project', projectId: '00000000-0000-4000-8000-000000000200' },
      level: 'project',
      filter: [{ kind: 'type_is', typeId: '00000000-0000-4000-8000-000000000010' }],
      sort: [],
      totals: [{ fn: 'sum', field: hours }],
      columns: [{ field: hours }, { field: 'decidedBy' }],
      createdAt: '2026-11-27T00:00:00.000Z',
      createdBy: null,
    });
    expect(view.level).toBe('project');
    expect(savedViewSchema.safeParse({ ...view, level: 'все' }).success).toBe(false);
    const create = createSavedViewBodySchema.parse({
      name: 'Мой вид',
      entity: 'folder',
      scope: { kind: 'journal' },
    });
    expect(create.filter).toEqual([]);
  });

  it('группа выдачи: ключ nullable, счётчик, итоги', () => {
    const bucket = listGroupBucketSchema.parse({
      key: null,
      count: 3,
      totals: [{ fn: 'sum', value: '24' }],
    });
    expect(bucket.key).toBeNull();
  });

  it('выгрузка CSV: тело валидно, статусы полны, константы русского Excel', () => {
    const body = createListExportBodySchema.parse({
      entity: 'task',
      scope: { kind: 'journal' },
      columns: [{ field: 'number' }, { field: hours }],
    });
    expect(body.columns).toHaveLength(2);
    expect(
      createListExportBodySchema.safeParse({
        entity: 'task',
        scope: { kind: 'journal' },
        columns: [],
      }).success,
    ).toBe(false);
    expect(CSV_EXPORT.bom).toBe('\uFEFF');
    expect(CSV_EXPORT.delimiter).toBe(';');
  });
});
