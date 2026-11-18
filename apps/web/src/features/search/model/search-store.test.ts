import { beforeEach, describe, expect, it } from 'vitest';

import { useSearchStore } from './search-store.js';

const reset = () =>
  useSearchStore.setState({
    mode: 'closed',
    query: '',
    types: [],
    projectId: null,
    period: 'any',
    sort: 'relevance',
  });

describe('стор поиска (#952)', () => {
  beforeEach(reset);

  it('Ctrl+K переключает компакт: закрыт → компакт → закрыт', () => {
    useSearchStore.getState().toggleCompact();
    expect(useSearchStore.getState().mode).toBe('compact');
    useSearchStore.getState().toggleCompact();
    expect(useSearchStore.getState().mode).toBe('closed');
  });

  it('Ctrl+K из рабочего окна закрывает его, запрос сохраняется', () => {
    useSearchStore.getState().setQuery('труба');
    useSearchStore.getState().openWorkspace();
    useSearchStore.getState().toggleCompact();
    expect(useSearchStore.getState().mode).toBe('closed');
    expect(useSearchStore.getState().query).toBe('труба');
  });

  it('компакт → рабочее окно переносит запрос и фильтры', () => {
    const store = useSearchStore.getState();
    store.setQuery('галур');
    store.toggleType('letter');
    store.setPeriod('month');
    store.openWorkspace();
    const state = useSearchStore.getState();
    expect(state.mode).toBe('workspace');
    expect(state.query).toBe('галур');
    expect(state.types).toEqual(['letter']);
    expect(state.period).toBe('month');
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

  it('сброс фильтров не трогает строку запроса', () => {
    const store = useSearchStore.getState();
    store.setQuery('смета');
    store.toggleType('project');
    store.setProjectId('project-1');
    store.setPeriod('year');
    store.setSort('newest');
    store.resetFilters();
    const state = useSearchStore.getState();
    expect(state).toMatchObject({
      query: 'смета',
      types: [],
      projectId: null,
      period: 'any',
      sort: 'relevance',
    });
  });
});
