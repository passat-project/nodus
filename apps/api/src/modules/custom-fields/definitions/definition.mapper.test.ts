import { describe, expect, it, vi } from 'vitest';

import { DefinitionMapper, type FieldDefinitionRow } from './definition.mapper.js';

/**
 * DTO определения (#631): имена ссылок статического умолчания гидрируются
 * без актёра (ссылки-записи в умолчаниях запрещены), а значение глобальной
 * переменной — ГЛАЗАМИ АКТЁРА запроса (#646): иначе ссылочная глобальная
 * показывала «Запись недоступна» даже тому, кто её видит.
 */
const TASK = '00000000-0000-4000-8000-000000000501';
const ACTOR = { id: 'u-1', permissions: [] };

const ROW: FieldDefinitionRow = {
  id: '00000000-0000-4000-8000-0000000005aa',
  number: 7,
  type: 'task',
  name: 'Задача компании',
  hint: null,
  settings: {},
  defaultValue: null,
  reportIndexed: false,
  isCompany: true,
  companyValue: { value: TASK },
  bindings: [],
  sortOrder: 0,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
} as FieldDefinitionRow;

function make() {
  const dictionaries = { dictionaryRefs: vi.fn(async () => []) };
  const refs = {
    hydrate: vi.fn(
      async (_definitions: unknown, _values: unknown, actor: { id: string } | undefined) => [
        {
          kind: 'task',
          id: TASK,
          name: actor ? 'Согласовать CDE' : null,
          avatarUrl: null,
          archived: false,
        },
      ],
    ),
  };
  const mapper = new DefinitionMapper(
    dictionaries as never,
    refs as never,
    { summaries: async () => new Map() } as never,
  );
  return { mapper, refs };
}

describe('DefinitionMapper.companyRefs (#646)', () => {
  it('гидрирует значение глобальной переменной глазами актёра запроса', async () => {
    const { mapper, refs } = make();
    const [dto] = await mapper.toDtos([ROW], undefined, ACTOR);
    expect(dto?.companyRefs).toEqual([
      expect.objectContaining({ kind: 'task', id: TASK, name: 'Согласовать CDE' }),
    ]);
    // Два вызова: умолчания — без актёра, глобальная — с актёром.
    expect(refs.hydrate).toHaveBeenCalledTimes(2);
    expect(refs.hydrate.mock.calls[0]?.[2]).toBeUndefined();
    expect(refs.hydrate.mock.calls[1]?.[2]).toBe(ACTOR);
  });

  it('без актёра имя ссылки не раскрывается (name null), id сохраняется', async () => {
    const { mapper } = make();
    const [dto] = await mapper.toDtos([ROW]);
    expect(dto?.companyRefs).toEqual([
      expect.objectContaining({ kind: 'task', id: TASK, name: null }),
    ]);
  });
});
