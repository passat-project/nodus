// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openInNewTab, openOrFocusTab } from '../../../shared/lib/tab-bridge.js';
import { usePortalTabsStore } from './tabs-store.js';
import { useTabsController } from './use-tabs-controller.js';

/**
 * Контроллер вкладок (#1038): старт сессии (seed/restore), запись ВНЕШНИХ
 * навигаций в активную вкладку и применение намерений (переключение/назад-
 * вперёд) — навигацией роутера. Роутер — мок (useRouter), оболочка —
 * window.nodusDesktop.
 */

const h = vi.hoisted(() => {
  const navigate = vi.fn(async () => undefined);
  const listeners: Record<
    string,
    (event: { toLocation: { pathname: string; searchStr: string } }) => void
  > = {};
  const router = {
    state: { location: { pathname: '/tasks', searchStr: '?view=kanban' } },
    navigate,
    subscribe: (
      type: string,
      fn: (event: { toLocation: { pathname: string; searchStr: string } }) => void,
    ) => {
      listeners[type] = fn;
      return () => {
        delete listeners[type];
      };
    },
  };
  return { navigate, listeners, router };
});

vi.mock('@tanstack/react-router', () => ({ useRouter: () => h.router }));

function resolve(pathname: string, searchStr = ''): void {
  h.listeners['onResolved']?.({ toLocation: { pathname, searchStr } });
}

function setStateShell(on: boolean): void {
  if (on) {
    (window as { nodusDesktop?: object }).nodusDesktop = {};
  } else {
    delete (window as { nodusDesktop?: object }).nodusDesktop;
  }
}

function resetStore(): void {
  usePortalTabsStore.setState({ tabs: [], activeId: null, histories: {}, navSeq: 0 });
}

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
  h.navigate.mockClear();
  for (const key of Object.keys(h.listeners)) delete h.listeners[key];
  setStateShell(true);
});

afterEach(() => {
  cleanup();
  setStateShell(false);
  resetStore();
  window.localStorage.clear();
});

describe('useTabsController: старт сессии (#1038)', () => {
  it('первый запуск — seeding текущим адресом, роутер не трогается', () => {
    renderHook(() => useTabsController());
    const state = usePortalTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.url).toBe('/tasks?view=kanban');
    expect(state.activeId).toBe(state.tabs[0]!.id);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('персист вернул вкладки — restore: navigate на активную (replace)', () => {
    usePortalTabsStore.setState({
      tabs: [
        { id: 't1', url: '/letters?tab=incoming', pinned: false },
        { id: 't2', url: '/home', pinned: false },
      ],
      activeId: 't1',
      histories: {},
    });
    renderHook(() => useTabsController());
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith({ href: '/letters?tab=incoming', replace: true });
    expect(usePortalTabsStore.getState().tabs).toHaveLength(2); // seed не перезаписал
  });

  it('в браузере (не оболочка) контроллер ничего не делает', () => {
    setStateShell(false);
    renderHook(() => useTabsController());
    expect(usePortalTabsStore.getState().tabs).toHaveLength(0);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(Object.keys(h.listeners)).toEqual([]);
  });
});

describe('useTabsController: запись внешних навигаций (#1038)', () => {
  it('внешняя навигация записывается в активную вкладку', () => {
    usePortalTabsStore.getState().seedFromLocation('/tasks?view=kanban');
    renderHook(() => useTabsController());
    resolve('/letters', '?tab=incoming');
    const state = usePortalTabsStore.getState();
    expect(state.tabs[0]!.url).toBe('/letters?tab=incoming');
    expect(state.histories[state.activeId ?? '']!.entries).toEqual([
      '/tasks?view=kanban',
      '/letters?tab=incoming',
    ]);
    expect(h.navigate).not.toHaveBeenCalled(); // запись — не намерение
  });

  it('приход на текущую запись вкладки (переключение/назад) не записывается', () => {
    usePortalTabsStore.setState({
      tabs: [
        { id: 't1', url: '/home', pinned: false },
        { id: 't2', url: '/letters', pinned: false },
      ],
      activeId: 't1',
      histories: { t1: { entries: ['/home'], index: 0 }, t2: { entries: ['/letters'], index: 0 } },
    });
    renderHook(() => useTabsController());
    resolve('/home'); // restore-адрес активной вкладки
    expect(h.navigate).toHaveBeenCalledTimes(1); // только restore
    expect(usePortalTabsStore.getState().tabs[0]!.url).toBe('/home');
    expect(usePortalTabsStore.getState().histories['t1']!.entries).toEqual(['/home']);
  });

  it('навигация без активной вкладки — no-op', () => {
    renderHook(() => useTabsController());
    usePortalTabsStore.setState({ activeId: null, tabs: [] });
    resolve('/letters');
    expect(usePortalTabsStore.getState().tabs).toHaveLength(0);
  });
});

describe('useTabsController: применение намерений (#1038)', () => {
  it('switchTab → navigate на url новой вкладки; её запись не дублируется', () => {
    usePortalTabsStore.setState({
      tabs: [
        { id: 't1', url: '/home', pinned: false },
        { id: 't2', url: '/letters?tab=new', pinned: false },
      ],
      activeId: 't1',
      histories: {
        t1: { entries: ['/home'], index: 0 },
        t2: { entries: ['/letters?tab=new'], index: 0 },
      },
    });
    renderHook(() => useTabsController());
    usePortalTabsStore.getState().switchTab('t2');
    expect(h.navigate).toHaveBeenCalledWith({ href: '/letters?tab=new', replace: false });
    resolve('/letters', '?tab=new'); // роутер довёл до адреса вкладки
    expect(usePortalTabsStore.getState().tabs[1]!.url).toBe('/letters?tab=new');
    expect(usePortalTabsStore.getState().histories['t2']!.entries).toEqual(['/letters?tab=new']);
  });

  it('back → navigate на запись истории', () => {
    usePortalTabsStore.setState({
      tabs: [{ id: 't1', url: '/tasks?view=kanban', pinned: false }],
      activeId: 't1',
      histories: { t1: { entries: ['/home', '/tasks?view=kanban'], index: 1 } },
    });
    renderHook(() => useTabsController());
    usePortalTabsStore.getState().back();
    expect(h.navigate).toHaveBeenCalledWith({ href: '/home', replace: false });
    expect(usePortalTabsStore.getState().tabs[0]!.url).toBe('/home');
  });

  it('мост: openInNewTab focus:false — фоновая вкладка без навигации', () => {
    usePortalTabsStore.getState().seedFromLocation('/tasks?view=kanban');
    renderHook(() => useTabsController());
    openInNewTab('/letters?tab=incoming', { focus: false });
    const state = usePortalTabsStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]!.url).toBe('/letters?tab=incoming');
    expect(state.activeId).toBe(state.tabs[0]!.id); // фон
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('мост: openInNewTab по умолчанию — активирует и ведёт роутер', () => {
    usePortalTabsStore.getState().seedFromLocation('/tasks?view=kanban');
    renderHook(() => useTabsController());
    openInNewTab('/letters?tab=incoming');
    const state = usePortalTabsStore.getState();
    expect(state.activeId).toBe(state.tabs[1]!.id);
    expect(h.navigate).toHaveBeenCalledWith({ href: '/letters?tab=incoming', replace: false });
  });

  it('мост: openOrFocusTab — существующая вкладка модуля активируется без navigate', () => {
    usePortalTabsStore.setState({
      tabs: [
        { id: 't1', url: '/home', pinned: false },
        { id: 't2', url: '/chat/aaa', pinned: false },
      ],
      activeId: 't1',
      histories: { t1: { entries: ['/home'], index: 0 }, t2: { entries: ['/chat/aaa'], index: 0 } },
    });
    renderHook(() => useTabsController());
    h.navigate.mockClear();
    openOrFocusTab('/chat/bbb?thread=xyz', '/chat');
    expect(usePortalTabsStore.getState().activeId).toBe('t2'); // своя /chat-вкладка
    expect(usePortalTabsStore.getState().tabs).toHaveLength(2); // новой нет
    expect(h.navigate).not.toHaveBeenCalled(); // роутер ведёт вызвавший (мост)
    // Дальше вызвавший делает navigate: переход запишется в t2.
    resolve('/chat/bbb', '?thread=xyz');
    expect(usePortalTabsStore.getState().tabs[1]!.url).toBe('/chat/bbb?thread=xyz');
    expect(usePortalTabsStore.getState().histories['t2']!.entries).toEqual([
      '/chat/aaa',
      '/chat/bbb?thread=xyz',
    ]);
  });

  it('мост: openOrFocusTab без вкладки модуля — новая вкладка активна, navigate за вызвавшим', () => {
    usePortalTabsStore.getState().seedFromLocation('/tasks?view=kanban');
    renderHook(() => useTabsController());
    h.navigate.mockClear();
    openOrFocusTab('/chat/bbb', '/chat');
    const state = usePortalTabsStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]!.url).toBe('/chat/bbb');
    expect(state.activeId).toBe(state.tabs[1]!.id);
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
