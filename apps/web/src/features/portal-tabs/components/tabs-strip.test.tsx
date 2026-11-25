// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { usePortalTabsStore } from '../model/tabs-store.js';
import { TabsStrip } from './tabs-strip.js';

/**
 * Полоса вкладок (#1038) — минимальный рендер: активная выделена, закреплённая
 * без заголовка и без ✕, ✕ закрывает, средний клик закрывает, «+» открывает
 * новую. DnD-переупорядочивание — юнит-тестами стора (moveTab).
 */

beforeEach(() => {
  window.localStorage.clear();
  usePortalTabsStore.setState({
    tabs: [
      { id: 'pin', url: '/home', pinned: true },
      { id: 'a', url: '/tasks?view=kanban', pinned: false },
      { id: 'b', url: '/letters', pinned: false, title: 'Чат·Иван' },
    ],
    activeId: 'a',
    histories: {
      pin: { entries: ['/home'], index: 0 },
      a: { entries: ['/tasks?view=kanban'], index: 0 },
      b: { entries: ['/letters'], index: 0 },
    },
    navSeq: 0,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  usePortalTabsStore.setState({ tabs: [], activeId: null, histories: {}, navSeq: 0 });
});

describe('TabsStrip (#1038)', () => {
  it('рисует вкладки: активная выделена, у закреплённой нет заголовка', () => {
    const { getByRole, queryByText, getByText } = render(<TabsStrip />);
    const active = getByRole('tab', { selected: true });
    expect(active.getAttribute('title')).toBe('Задачи');
    // Закреплённая — только иконка: текста заголовка нет (метка в title).
    const pinned = getByRole('tab', { name: /главная/i });
    expect(pinned.getAttribute('draggable')).toBe('false');
    expect(queryByText('Главная')).toBeNull();
    // Сессионный заголовок перекрывает метку модуля.
    expect(getByText('Чат·Иван')).toBeTruthy();
  });

  it('✕ закрывает вкладку; сосед слева становится активной', () => {
    const { getAllByRole } = render(<TabsStrip />);
    const closeButtons = getAllByRole('button', { name: 'Закрыть вкладку' });
    // ✕ только у незакреплённых (2); у закреплённой — закрытие через ПКМ-меню.
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[0]!); // вкладка a — активная
    const state = usePortalTabsStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual(['pin', 'b']);
    expect(state.activeId).toBe('pin'); // сосед слева
    expect(state.navSeq).toBe(1); // намерение навигации для контроллера
  });

  it('средний клик закрывает вкладку', () => {
    const { getAllByRole } = render(<TabsStrip />);
    const target = getAllByRole('tab').find(
      (el) => el.getAttribute('title') === 'Чат·Иван',
    ) as HTMLElement;
    fireEvent.mouseDown(target, { button: 1 });
    fireEvent(target, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    expect(usePortalTabsStore.getState().tabs.map((t) => t.id)).toEqual(['pin', 'a']);
  });

  it('«+» открывает новую вкладку «/home» и активирует её', () => {
    const { getByRole } = render(<TabsStrip />);
    fireEvent.click(getByRole('button', { name: 'Новая вкладка' }));
    const state = usePortalTabsStore.getState();
    expect(state.tabs).toHaveLength(4);
    expect(state.tabs.at(-1)?.url).toBe('/home');
    expect(state.activeId).toBe(state.tabs.at(-1)?.id);
  });

  it('клик по вкладке — switchTab (намерение навигации)', () => {
    const { getByText } = render(<TabsStrip />);
    fireEvent.click(getByText('Чат·Иван'));
    const state = usePortalTabsStore.getState();
    expect(state.activeId).toBe('b');
    expect(state.navSeq).toBe(1);
  });
});
