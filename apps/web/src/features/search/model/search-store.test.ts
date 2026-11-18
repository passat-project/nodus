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

  it('Ctrl+K открывает и закрывает окно, запрос сохраняется', () => {
    useSearchStore.getState().setQuery('труба');
    useSearchStore.getState().toggle();
    expect(useSearchStore.getState().open).toBe(true);
    useSearchStore.getState().toggle();
    const state = useSearchStore.getState();
    expect(state.open).toBe(false);
    expect(state.query).toBe('труба');
  });

  it('openSearch и close управляют окном явно', () => {
    useSearchStore.getState().openSearch();
    expect(useSearchStore.getState().open).toBe(true);
    useSearchStore.getState().close();
    expect(useSearchStore.getState().open).toBe(false);
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
