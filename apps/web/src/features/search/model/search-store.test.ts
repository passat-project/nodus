import { beforeEach, describe, expect, it } from 'vitest';

import { useSearchStore } from './search-store.js';

const reset = () =>
  useSearchStore.setState({
    open: false,
    query: '',
    types: [],
    projectId: null,
    period: 'any',
    sort: 'relevance',
  });

describe('стор поиска (#952)', () => {
  beforeEach(reset);

  it('Ctrl+K открывает и закрывает окно, закрытие очищает строку', () => {
    useSearchStore.getState().setQuery('труба');
    useSearchStore.getState().toggle();
    expect(useSearchStore.getState().open).toBe(true);
    expect(useSearchStore.getState().query).toBe('труба');
    useSearchStore.getState().toggle();
    expect(useSearchStore.getState()).toMatchObject({ open: false, query: '' });
  });

  it('close очищает строку, но оставляет выбранные фильтры', () => {
    const store = useSearchStore.getState();
    store.openSearch();
    store.setQuery('смета');
    store.toggleType('task');
    store.close();
    expect(useSearchStore.getState()).toMatchObject({
      open: false,
      query: '',
      types: ['task'],
    });
  });

  it('тип переключается туда-обратно, пустой список — все типы', () => {
    const store = useSearchStore.getState();
    store.toggleType('task');
    store.toggleType('letter');
    expect(useSearchStore.getState().types).toEqual(['task', 'letter']);
    store.toggleType('task');
    expect(useSearchStore.getState().types).toEqual(['letter']);
    store.clearTypes();
    expect(useSearchStore.getState().types).toEqual([]);
  });

  it('сброс фильтров не трогает строку запроса и состояние окна', () => {
    const store = useSearchStore.getState();
    store.openSearch();
    store.setQuery('смета');
    store.toggleType('project');
    store.setProjectId('project-1');
    store.setPeriod('year');
    store.setSort('newest');
    store.resetFilters();
    const state = useSearchStore.getState();
    expect(state).toMatchObject({
      open: true,
      query: 'смета',
      types: [],
      projectId: null,
      period: 'any',
      sort: 'relevance',
    });
  });
});
