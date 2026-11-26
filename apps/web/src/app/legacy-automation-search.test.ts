// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { automationBeforeLoad, legacyProjectSchemasSearch } from './legacy-automation-search.js';
// Импорт роутера исполняет привязку beforeLoad маршрута /automation
// (строка в покрытии: ссылка на функцию — не мёртвый код).
import './router.js';

describe('легаси-редирект «Схемы проектов» → «Процессы» (#857)', () => {
  it('чужая вкладка не трогается', () => {
    expect(legacyProjectSchemasSearch({ tab: 'fields' })).toBeNull();
    expect(legacyProjectSchemasSearch({})).toBeNull();
  });

  it('tab=project-schemas → tab=processes, type→ptype, kind→ftype', () => {
    expect(
      legacyProjectSchemasSearch({ tab: 'project-schemas', type: 'p-1', kind: 'k-2' }),
    ).toEqual({ tab: 'processes', ptype: 'p-1', ftype: 'k-2' });
    expect(legacyProjectSchemasSearch({ tab: 'project-schemas' })).toEqual({ tab: 'processes' });
    // только тип проекта
    expect(legacyProjectSchemasSearch({ tab: 'project-schemas', type: 'p-1' })).toEqual({
      tab: 'processes',
      ptype: 'p-1',
    });
    // только тип папки
    expect(legacyProjectSchemasSearch({ tab: 'project-schemas', kind: 'k-9' })).toEqual({
      tab: 'processes',
      ftype: 'k-9',
    });
  });

  it('старые ключи type/kind не протекают в новый адрес', () => {
    const next = legacyProjectSchemasSearch({ tab: 'project-schemas', type: 'p-1' });
    expect(next).not.toHaveProperty('type');
    expect(next).not.toHaveProperty('kind');
  });

  it('посторонние параметры сохраняются', () => {
    expect(legacyProjectSchemasSearch({ tab: 'project-schemas', foo: 'bar', type: 'p-1' })).toEqual(
      { foo: 'bar', tab: 'processes', ptype: 'p-1' },
    );
  });
});

describe('beforeLoad маршрута /automation (#857)', () => {
  it('легаси-адрес бросает redirect на единый вход', () => {
    expect(() =>
      automationBeforeLoad({ search: { tab: 'project-schemas', type: 'p-1' } }),
    ).toThrow();
  });

  it('свежий адрес проходит без редиректа', () => {
    expect(() =>
      automationBeforeLoad({ search: { tab: 'processes', ptype: 'p-1', ftype: 'k-1' } }),
    ).not.toThrow();
    expect(() => automationBeforeLoad({ search: {} })).not.toThrow();
  });
});
