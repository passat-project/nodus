// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { usePortalTabsStore, portalTabsEnvelopeSchema, canBack, canForward } from './tabs-store.js';

/** Состав вкладок «id:url», pinned — с суффиксом *. */
function strip(): string {
  return usePortalTabsStore
    .getState()
    .tabs.map((t) => `${t.id}:${t.url}${t.pinned ? '*' : ''}`)
    .join(' | ');
}

function resetStore(): void {
  usePortalTabsStore.setState({ tabs: [], activeId: null, histories: {}, navSeq: 0 });
}

function seedThree(): { a: string; b: string; c: string } {
  usePortalTabsStore.setState({
    tabs: [
      { id: 'a', url: '/home', pinned: false },
      { id: 'b', url: '/tasks?view=kanban', pinned: false },
      { id: 'c', url: '/letters', pinned: false },
    ],
    activeId: 'b',
    histories: {
      a: { entries: ['/home'], index: 0 },
      b: { entries: ['/home', '/tasks?view=kanban'], index: 1 },
      c: { entries: ['/letters'], index: 0 },
    },
    navSeq: 0,
  });
  return { a: 'a', b: 'b', c: 'c' };
}

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
});

afterEach(() => {
  window.localStorage.clear();
  resetStore();
});

describe('tabs-store: навигация вкладки (#1038)', () => {
  it('recordNavigation обновляет url и пишет в историю активной вкладки', () => {
    const { b } = seedThree();
    usePortalTabsStore.getState().recordNavigation('/tasks?view=list');
    const history = usePortalTabsStore.getState().histories[b]!;
    expect(usePortalTabsStore.getState().tabs.find((t) => t.id === b)?.url).toBe(
      '/tasks?view=list',
    );
    expect(history.entries).toEqual(['/home', '/tasks?view=kanban', '/tasks?view=list']);
    expect(history.index).toBe(2);
    expect(usePortalTabsStore.getState().navSeq).toBe(0); // отражение, не намерение
  });

  it('подряд одинаковые адреса не пушатся', () => {
    const { b } = seedThree();
    usePortalTabsStore.getState().recordNavigation('/tasks?view=list');
    usePortalTabsStore.getState().recordNavigation('/tasks?view=list');
    expect(usePortalTabsStore.getState().histories[b]!.entries).toEqual([
      '/home',
      '/tasks?view=kanban',
      '/tasks?view=list',
    ]);
  });

  it('новая навигация после назад() обрезает хвост «вперёд» (модель браузера)', () => {
    const { b } = seedThree();
    usePortalTabsStore.getState().back();
    usePortalTabsStore.getState().recordNavigation('/tasks?view=list');
    expect(usePortalTabsStore.getState().histories[b]!.entries).toEqual([
      '/home',
      '/tasks?view=list',
    ]);
  });

  it('навигация без активной вкладки — no-op', () => {
    usePortalTabsStore.setState({ activeId: null });
    usePortalTabsStore.getState().recordNavigation('/tasks');
    expect(usePortalTabsStore.getState().histories).toEqual({});
  });

  it('back/forward двигают index и зеркалят url; края — no-op', () => {
    const { b } = seedThree();
    const store = usePortalTabsStore.getState();
    expect(canBack(usePortalTabsStore.getState(), b)).toBe(true);
    expect(canForward(usePortalTabsStore.getState(), b)).toBe(false);
    store.back();
    expect(usePortalTabsStore.getState().histories[b]!.index).toBe(0);
    expect(usePortalTabsStore.getState().tabs.find((t) => t.id === b)?.url).toBe('/home');
    expect(usePortalTabsStore.getState().navSeq).toBe(1); // намерение для контроллера
    store.back(); // край — no-op
    expect(usePortalTabsStore.getState().navSeq).toBe(1);
    usePortalTabsStore.getState().forward();
    expect(usePortalTabsStore.getState().histories[b]!.index).toBe(1);
    usePortalTabsStore.getState().forward(); // край — no-op
    expect(usePortalTabsStore.getState().navSeq).toBe(2);
  });
});

describe('tabs-store: состав вкладок (#1038)', () => {
  it('seedFromLocation — первый запуск: одна вкладка текущим адресом, без намерения', () => {
    usePortalTabsStore.getState().seedFromLocation('/tasks?view=kanban');
    const state = usePortalTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.url).toBe('/tasks?view=kanban');
    expect(state.activeId).toBe(state.tabs[0]!.id);
    expect(state.histories[state.activeId!]).toEqual({ entries: ['/tasks?view=kanban'], index: 0 });
    expect(state.navSeq).toBe(0);
  });

  it('seedFromLocation при непустом составе — no-op (restore победил)', () => {
    seedThree();
    usePortalTabsStore.getState().seedFromLocation('/home');
    expect(usePortalTabsStore.getState().tabs).toHaveLength(3);
  });

  it('openTab: справа, после закреплённых; focus — активировать и намереваться', () => {
    seedThree();
    const store = usePortalTabsStore.getState();
    store.togglePin('a');
    const seqBefore = usePortalTabsStore.getState().navSeq;
    const id = store.openTab('/letters?tab=incoming');
    expect(strip()).toBe(
      'a:/home* | b:/tasks?view=kanban | c:/letters | ' + id + ':/letters?tab=incoming',
    );
    expect(usePortalTabsStore.getState().activeId).toBe(id);
    expect(usePortalTabsStore.getState().navSeq).toBe(seqBefore + 1);
  });

  it('openTab focus:false — фоновая вкладка без активации', () => {
    seedThree();
    const seqBefore = usePortalTabsStore.getState().navSeq;
    const id = usePortalTabsStore.getState().openTab('/crm', { focus: false });
    expect(usePortalTabsStore.getState().activeId).toBe('b');
    expect(usePortalTabsStore.getState().navSeq).toBe(seqBefore);
    expect(usePortalTabsStore.getState().tabs.at(-1)?.id).toBe(id);
  });

  it('closeTab активной — сосед слева; закрытой первой — сосед справа', () => {
    seedThree();
    usePortalTabsStore.getState().closeTab('b');
    expect(usePortalTabsStore.getState().activeId).toBe('a');
    usePortalTabsStore.getState().closeTab('a');
    expect(usePortalTabsStore.getState().activeId).toBe('c');
    expect(usePortalTabsStore.getState().tabs.map((t) => t.id)).toEqual(['c']);
  });

  it('закрытие последней вкладки — новая «/home»', () => {
    seedThree();
    const store = usePortalTabsStore.getState();
    store.closeTab('a');
    store.closeTab('c');
    store.closeTab('b');
    const state = usePortalTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.url).toBe('/home');
    expect(state.activeId).toBe(state.tabs[0]!.id);
    expect(state.histories).not.toHaveProperty('b'); // истории закрытых ушли
  });

  it('closeTab неактивной не меняет активную и не намеревается', () => {
    seedThree();
    const seqBefore = usePortalTabsStore.getState().navSeq;
    usePortalTabsStore.getState().closeTab('c');
    expect(usePortalTabsStore.getState().activeId).toBe('b');
    expect(usePortalTabsStore.getState().navSeq).toBe(seqBefore);
  });

  it('togglePin: закреп уходит в конец закреплённой группы, откреп — в начало незакреплённых', () => {
    seedThree();
    const store = usePortalTabsStore.getState();
    store.togglePin('c');
    expect(strip()).toBe('c:/letters* | a:/home | b:/tasks?view=kanban');
    store.togglePin('a');
    expect(strip()).toBe('c:/letters* | a:/home* | b:/tasks?view=kanban');
    store.togglePin('a');
    expect(strip()).toBe('c:/letters* | a:/home | b:/tasks?view=kanban');
  });

  it('moveTab: незакреплённые внутри своего диапазона, закреплённые не двигаются', () => {
    seedThree();
    const store = usePortalTabsStore.getState();
    store.togglePin('a');
    store.moveTab('c', 1); // конечная позиция 1 — между закрепом и b
    expect(strip()).toBe('a:/home* | c:/letters | b:/tasks?view=kanban');
    store.moveTab('a', 3); // закреплённые не перетаскиваются
    expect(strip()).toBe('a:/home* | c:/letters | b:/tasks?view=kanban');
    store.moveTab('b', 0); // кламп в незакреплённый диапазон (после закрепа)
    expect(strip()).toBe('a:/home* | b:/tasks?view=kanban | c:/letters');
  });
});

describe('tabs-store: сессионный заголовок (#1038)', () => {
  it('setTabTitle ставит/снимает заголовок активной вкладки, чужие не трогает', () => {
    seedThree();
    const store = usePortalTabsStore.getState();
    store.setTabTitle('Чат·Иван');
    expect(usePortalTabsStore.getState().tabs.find((t) => t.id === 'b')?.title).toBe('Чат·Иван');
    usePortalTabsStore.getState().activate('c');
    store.setTabTitle('Письма');
    const tabs = usePortalTabsStore.getState().tabs;
    expect(tabs.find((t) => t.id === 'b')?.title).toBe('Чат·Иван');
    expect(tabs.find((t) => t.id === 'c')?.title).toBe('Письма');
    store.setTabTitle(undefined);
    expect(usePortalTabsStore.getState().tabs.find((t) => t.id === 'c')?.title).toBeUndefined();
  });

  it('заголовок не персистится (только id/url/pinned + activeId)', () => {
    seedThree();
    const store = usePortalTabsStore.getState();
    store.setTabTitle('Чат·Иван');
    const raw = window.localStorage.getItem('nodus-portal-tabs-v1');
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw ?? '{}') as { state?: Record<string, unknown> };
    expect(Object.keys(saved.state ?? {}).sort()).toEqual(['activeId', 'tabs']);
    const tabs = saved.state?.tabs as Array<Record<string, unknown>>;
    expect(tabs[1]!).toEqual({ id: 'b', url: '/tasks?view=kanban', pinned: false });
  });
});

describe('tabs-store: восстановление после рестарта (#1038)', () => {
  it('у вкладки без истории история = её текущий адрес (ленивая фабрика)', () => {
    usePortalTabsStore.setState({
      tabs: [{ id: 'restored', url: '/tasks?view=list', pinned: false }],
      activeId: 'restored',
      histories: {},
    });
    expect(canBack(usePortalTabsStore.getState(), 'restored')).toBe(false);
    usePortalTabsStore.getState().recordNavigation('/tasks?view=kanban');
    const history = usePortalTabsStore.getState().histories['restored'];
    expect(history).toEqual({ entries: ['/tasks?view=list', '/tasks?view=kanban'], index: 1 });
  });

  it('envelope: битый activeId вне состава вкладок отбрасывает хранилище', () => {
    expect(
      portalTabsEnvelopeSchema.safeParse({
        tabs: [{ id: 'a', url: '/home', pinned: false }],
        activeId: 'ghost',
      }).success,
    ).toBe(false);
    expect(
      portalTabsEnvelopeSchema.safeParse({
        tabs: [{ id: 'a', url: '/home', pinned: true }],
        activeId: 'a',
      }).success,
    ).toBe(true);
    expect(portalTabsEnvelopeSchema.safeParse({ tabs: [], activeId: null }).success).toBe(true);
  });
});
