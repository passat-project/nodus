import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { createCustomFieldBodySchema, updateCustomFieldBodySchema } from '@nodus/contracts';

import {
  createBody,
  DRAFT_PREFIX,
  draftIssues,
  draftOf,
  draftType,
  emptyDraft,
  listDefault,
  patchBody,
  scalarDefault,
  withFamily,
} from './field-draft.js';

const ID = '50000000-0000-4000-8000-000000000001';
const DICT = '50000000-0000-4000-8000-000000000002';
const ITEM_A = '50000000-0000-4000-8000-00000000000a';
const ITEM_B = '50000000-0000-4000-8000-00000000000b';

function definition(partial: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: ID,
    scope: 'task',
    type: 'text',
    name: 'Атрибут',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    hidden: false,
    typeIds: [],
    sortOrder: 0,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
    ...partial,
  };
}

const items = [
  {
    id: ITEM_A,
    dictionaryId: DICT,
    parentId: null,
    code: null,
    name: 'А',
    sortOrder: 0,
    isActive: true,
  },
  {
    id: ITEM_B,
    dictionaryId: DICT,
    parentId: null,
    code: null,
    name: 'Б',
    sortOrder: 1,
    isActive: true,
  },
];

describe('черновик окна атрибута (#431, ревизия UI)', () => {
  it('тип — из семейства и модификатора', () => {
    const text = withFamily(emptyDraft, 'text');
    expect(draftType(text)).toBe('text');
    expect(draftType({ ...text, modifier: true })).toBe('long_text');
    expect(draftType({ ...withFamily(emptyDraft, 'list'), modifier: true })).toBe('multienum');
    expect(draftType(emptyDraft)).toBeNull();
  });

  it('смена семейства сбрасывает настройки и умолчание прежнего типа', () => {
    const number = { ...withFamily(emptyDraft, 'number'), defaultMode: 'static' as const };
    const text = withFamily(number, 'text');
    expect(text.settings).toEqual({});
    expect(text.defaultMode).toBe('none');
    expect(withFamily(emptyDraft, 'number').settings).toEqual({ precision: 0 });
  });

  it('проверка: имя, тип, варианты без пустых и повторов', () => {
    expect(draftIssues(emptyDraft)).toEqual(['name', 'family']);
    const list = { ...withFamily(emptyDraft, 'list'), name: 'Вид' };
    expect(draftIssues(list)).toEqual(['options']);
    const dup = {
      ...list,
      options: [
        { id: 'draft:1', name: 'А' },
        { id: 'draft:2', name: ' а ' },
      ],
    };
    expect(draftIssues(dup)).toEqual(['optionsDuplicate']);
  });

  it('умолчание списка — отмеченные варианты, временные id → серверные', () => {
    const tmp = `${DRAFT_PREFIX}x`;
    const draft = {
      ...withFamily(emptyDraft, 'list'),
      options: [
        { id: ITEM_A, name: 'А' },
        { id: tmp, name: 'Новый' },
      ],
      defaultOptionIds: [tmp, 'удалённый'],
    };
    const created = '50000000-0000-4000-8000-0000000000cc';
    expect(listDefault(draft, 'enum', new Map([[tmp, created]]))).toEqual({
      kind: 'static',
      value: created,
    });
    expect(
      listDefault(
        { ...draft, defaultOptionIds: [ITEM_A, tmp] },
        'multienum',
        new Map([[tmp, created]]),
      ),
    ).toEqual({ kind: 'static', value: [ITEM_A, created] });
    expect(listDefault({ ...draft, defaultOptionIds: [] }, 'enum', new Map())).toBeNull();
  });

  it('режим «Нет» отбрасывает выбранное значение', () => {
    const draft = {
      ...withFamily(emptyDraft, 'text'),
      defaultValue: { kind: 'static' as const, value: 'x' },
    };
    expect(scalarDefault({ ...draft, defaultMode: 'none' })).toBeNull();
    expect(scalarDefault({ ...draft, defaultMode: 'static' })).toEqual(draft.defaultValue);
  });

  it('тело создания проходит схему контракта (скрытый, подсказка, точность)', () => {
    const draft = {
      ...withFamily(emptyDraft, 'number'),
      name: ' Площадь ',
      hint: '  м² ',
      hidden: true,
      settings: { precision: 2 },
    };
    const body = createBody(draft, 'task', {});
    expect(createCustomFieldBodySchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      name: 'Площадь',
      hint: 'м²',
      hidden: true,
      settings: { precision: 2 },
    });
  });

  it('черновик сохранённого списка и правка — только изменённые ключи', () => {
    const saved = definition({
      type: 'enum',
      settings: { dictionaryId: DICT },
      dictionary: { id: DICT, code: 'list-1', name: 'Вид', isSystem: false },
      defaultValue: { kind: 'static', value: ITEM_B },
    });
    const draft = draftOf(saved, items);
    expect(draft.options).toEqual([
      { id: ITEM_A, name: 'А' },
      { id: ITEM_B, name: 'Б' },
    ]);
    expect(draft.defaultOptionIds).toEqual([ITEM_B]);
    expect(patchBody(saved, draft, saved.defaultValue)).toBeNull();

    const next = { ...draft, modifier: true, hidden: true };
    const body = patchBody(saved, next, listDefault(next, 'multienum', new Map()));
    expect(body).toEqual({
      type: 'multienum',
      hidden: true,
      defaultValue: { kind: 'static', value: [ITEM_B] },
    });
    expect(updateCustomFieldBodySchema.safeParse(body).success).toBe(true);
  });

  it('правка списка без права на справочники не теряет умолчание (#491)', () => {
    const saved = definition({
      type: 'enum',
      settings: { dictionaryId: DICT },
      dictionary: { id: DICT, code: 'list-1', name: 'Вид', isSystem: false },
      defaultValue: { kind: 'static', value: ITEM_B },
    });
    const draft = draftOf(saved, items);
    // Варианты только для чтения; пользователь меняет лишь название.
    const renamed = { ...draft, name: 'Новое название' };
    // id вариантов уже серверные — умолчание вычисляется без маппинга.
    const defaultValue = listDefault(renamed, 'enum', new Map());
    expect(patchBody(saved, renamed, defaultValue)).toEqual({ name: 'Новое название' });
  });
});
