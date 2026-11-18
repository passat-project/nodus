// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

vi.mock('../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => false,
}));
vi.mock('../../../shared/api/projects-list.js', () => ({
  useProjectsList: () => ({ data: { items: [] } }),
}));
vi.mock('../../../shared/chat/composer-focus.js', () => ({
  focusComposerWhenFree: vi.fn(),
}));

import { useSearchStore } from '../model/search-store.js';
import { SearchFilterRail } from './search-filter-rail.js';

/**
 * Панель фильтров (#952): все пять источников видны всегда (правка
 * владельца 18.11.2026), фасеты не скрывают строки, «Сбросить фильтры»
 * появляется под проектом только при активных фильтрах, высота панели от
 * этого не меняется (кнопка не отдельной строкой внизу — вердикт владельца).
 */
beforeEach(() => {
  useSearchStore.setState({
    open: false,
    query: '',
    types: [],
    projectId: null,
    period: 'any',
    sort: 'relevance',
  });
});
afterEach(cleanup);

const facets = { task: 1, letter: 2, project: 4 };

describe('панель фильтров поиска (#952)', () => {
  it('показывает все пять источников, общий счётчик — в «Все типы»', () => {
    render(<SearchFilterRail facets={facets} />);
    for (const type of ['task', 'letter', 'message', 'project', 'employee'] as const) {
      expect(screen.getByRole('button', { name: new RegExp(ui.search.types[type]) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /Все типы/ }).textContent).toContain('7');
    // Нулевой тип приглушён, но остаётся на месте (карта источников).
    expect(screen.getByRole('button', { name: /Сообщения/ })).toBeTruthy();
  });

  it('тип переключается, «Сбросить фильтры» появляется и очищает выбор', () => {
    render(<SearchFilterRail facets={facets} />);
    expect(screen.queryByRole('button', { name: ui.search.filters.reset })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Задачи/ }));
    expect(useSearchStore.getState().types).toEqual(['task']);
    expect(screen.getByRole('button', { name: /Задачи/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: ui.search.filters.reset }));
    expect(useSearchStore.getState().types).toEqual([]);
    expect(screen.queryByRole('button', { name: ui.search.filters.reset })).toBeNull();
  });

  it('повторный клик по типу снимает фильтр', () => {
    render(<SearchFilterRail facets={facets} />);
    const letter = screen.getByRole('button', { name: /Письма/ });
    fireEvent.click(letter);
    fireEvent.click(letter);
    expect(useSearchStore.getState().types).toEqual([]);
  });

  it('период и сортировка пишутся в стор', () => {
    render(<SearchFilterRail facets={facets} />);
    fireEvent.click(screen.getByRole('button', { name: ui.search.filters.week }));
    fireEvent.click(screen.getByRole('button', { name: ui.search.filters.newest }));
    expect(useSearchStore.getState()).toMatchObject({ period: 'week', sort: 'newest' });
    // «Сбросить» виден и при невыбранных типах: активны другие фильтры.
    expect(screen.getByRole('button', { name: ui.search.filters.reset })).toBeTruthy();
  });

  it('модуль проектов выключен — секции проекта нет', () => {
    render(<SearchFilterRail facets={facets} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
