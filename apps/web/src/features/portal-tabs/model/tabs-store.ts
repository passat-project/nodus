import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { zodPersistMerge } from '../../../shared/lib/persist-zod.js';

/**
 * Вкладки браузерного типа (#1038 фаза C, ADR-0055): полоса живёт в панели
 * оболочки, поэтому стор активен ТОЛЬКО в оболочке (контроллер монтируется
 * из AppShell при isDesktopShell(); в браузере стором никто не пользуется).
 *
 * Модель: вкладка — адрес (pathname+search, БЕЗ hash) + закреп + сессионный
 * заголовок; у каждой вкладки СВОЯ история навигаций (модель браузера:
 * запись навигации обрезает хвост вперёд), активная вкладка одна. История и
 * заголовки сессионные — персистится только состав вкладок и активная
 * (частичная загрузка: после рестарта история вкладки = её текущий адрес).
 *
 * navSeq — счётчик НАМЕРЕНИЙ навигации (переключение/открытие/назад-вперёд):
 * его растёт контроллер и ведёт роутер на текущую запись активной вкладки.
 * recordNavigation навигационного намерения НЕ даёт — он отражает уже
 * случившийся переход (внешнюю навигацию). activate — низкоуровневая
 * активация без намерения: вызвавший сам ведёт роутер (мост deep-link).
 */

/** Сколько переходов хранит история одной вкладки (модель браузера — глубина). */
const HISTORY_LIMIT = 50;

export interface PortalTab {
  id: string;
  /** pathname+search без hash — как хранит контроллер (onResolved). */
  url: string;
  pinned: boolean;
  /** Сессионный кастомный заголовок (не персистится): «Чат·Имя» фичи чата. */
  title?: string;
}

export interface TabHistory {
  entries: string[];
  index: number;
}

export interface TabsState {
  tabs: PortalTab[];
  activeId: string | null;
  histories: Record<string, TabHistory>;
  navSeq: number;
  seedFromLocation(url: string): void;
  activate(id: string): void;
  switchTab(id: string): void;
  recordNavigation(url: string): void;
  /** Возвращает id новой вкладки. */
  openTab(url: string, options?: { focus?: boolean }): string;
  closeTab(id: string): void;
  togglePin(id: string): void;
  /** Конечная позиция после переупорядочивания; клампится в незакреплённый диапазон. */
  moveTab(id: string, index: number): void;
  setTabTitle(title: string | undefined): void;
  back(): void;
  forward(): void;
}

function makeTabId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function activeTabOf(state: Pick<TabsState, 'tabs' | 'activeId'>): PortalTab | undefined {
  return state.tabs.find((t) => t.id === state.activeId);
}

/** История вкладки; у восстановленной после рестарта — её текущий адрес. */
function historyOf(
  state: Pick<TabsState, 'tabs' | 'histories'>,
  id: string | null | undefined,
): TabHistory | undefined {
  if (!id) return undefined;
  const existing = state.histories[id];
  if (existing) return existing;
  const tab = state.tabs.find((t) => t.id === id);
  return tab ? { entries: [tab.url], index: 0 } : undefined;
}

/** Крайние позиции перетаскивания/вставки: незакреплённые живут после закреплённых. */
function unpinnedRange(tabs: readonly PortalTab[]): { from: number; to: number } {
  return { from: tabs.filter((t) => t.pinned).length, to: tabs.length };
}

/** url зеркалит текущую запись истории (инвариант стора — опора контроллера). */
function withCurrentUrl(tabs: PortalTab[], id: string, url: string): PortalTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, url } : t));
}

/**
 * Envelope персиста (I7 «zod на границах», канон persist-zod.ts): битая
 * вкладка или activeId вне состава вкладок отбрасывают хранилище целиком —
 * контроллер на старте засеет одну вкладку текущим адресом.
 */
export const portalTabsEnvelopeSchema = z
  .object({
    tabs: z
      .array(
        z.object({
          id: z.string().min(1),
          url: z.string().min(1),
          pinned: z.boolean().catch(false),
        }),
      )
      .catch([]),
    activeId: z.string().nullable().catch(null),
  })
  .superRefine((value, ctx) => {
    if (value.activeId && !value.tabs.some((t) => t.id === value.activeId)) {
      ctx.addIssue({ code: 'custom', message: 'activeId вне состава вкладок' });
    }
  });

export const usePortalTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      histories: {},
      navSeq: 0,

      seedFromLocation(url) {
        if (get().tabs.length > 0) return;
        const id = makeTabId();
        set({
          tabs: [{ id, url, pinned: false }],
          activeId: id,
          histories: { [id]: { entries: [url], index: 0 } },
          // navSeq не растёт: сеанс стартует на текущем адресе, роутер уже там.
        });
      },

      activate(id) {
        if (!get().tabs.some((t) => t.id === id) || get().activeId === id) return;
        set({ activeId: id });
      },

      switchTab(id) {
        const { activate } = get();
        const before = get().activeId;
        activate(id);
        if (get().activeId === before) return;
        set((s) => ({ navSeq: s.navSeq + 1 }));
      },

      recordNavigation(url) {
        const state = get();
        const tab = activeTabOf(state);
        if (!tab) return;
        const history = historyOf(state, tab.id) ?? { entries: [tab.url], index: 0 };
        if (url === history.entries[history.index]) return;
        // Модель браузера: новая запись обрезает хвост «вперёд».
        const entries = [...history.entries.slice(0, history.index + 1), url].slice(-HISTORY_LIMIT);
        set({
          tabs: withCurrentUrl(state.tabs, tab.id, url),
          histories: {
            ...state.histories,
            [tab.id]: { entries, index: entries.length - 1 },
          },
        });
      },

      openTab(url, options) {
        const state = get();
        const id = makeTabId();
        const focus = options?.focus ?? true;
        // Новая вкладка — СПРАВА, в конец полосы (закреплённые — всегда
        // ведущая группа, новая идёт после них); фокус решает активацию.
        const tabs = [...state.tabs, { id, url, pinned: false }];
        set({
          tabs,
          histories: { ...state.histories, [id]: { entries: [url], index: 0 } },
          ...(focus ? { activeId: id, navSeq: state.navSeq + 1 } : {}),
        });
        return id;
      },

      closeTab(id) {
        const state = get();
        const index = state.tabs.findIndex((t) => t.id === id);
        if (index < 0) return;
        const tabs = state.tabs.filter((t) => t.id !== id);
        const histories = { ...state.histories };
        delete histories[id];
        if (state.activeId !== id) {
          set({ tabs, histories });
          return;
        }
        // Активную закрываем: сосед слева, нет — сосед справа; вкладок нет —
        // новая вкладка с дефолтным адресом.
        const neighbor = tabs[index - 1] ?? tabs[index];
        if (neighbor) {
          set({ tabs, histories, activeId: neighbor.id, navSeq: state.navSeq + 1 });
          return;
        }
        set({ tabs, histories, activeId: null });
        get().openTab('/home', { focus: true });
      },

      togglePin(id) {
        const state = get();
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) return;
        const toggled = { ...tab, pinned: !tab.pinned };
        // Закреп: в конец закреплённой группы; откреп: первым среди
        // незакреплённых — закреплённые всегда ведущая группа полосы.
        const rest = state.tabs.filter((t) => t.id !== id);
        const target = toggled.pinned ? unpinnedRange(state.tabs).from : unpinnedRange(rest).from;
        rest.splice(Math.min(target, rest.length), 0, toggled);
        set({ tabs: rest });
      },

      moveTab(id, index) {
        const state = get();
        const tab = state.tabs.find((t) => t.id === id);
        // Закреплённые не перетаскиваются (всегда ведущая группа).
        if (!tab || tab.pinned) return;
        const rest = state.tabs.filter((t) => t.id !== id);
        const { from, to } = unpinnedRange(rest);
        const target = Math.min(Math.max(index, from), to);
        if (state.tabs.findIndex((t) => t.id === id) === target) return;
        rest.splice(target, 0, tab);
        set({ tabs: rest });
      },

      setTabTitle(title) {
        const state = get();
        const tab = activeTabOf(state);
        if (!tab || (tab.title ?? undefined) === title) return;
        set({ tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, title } : t)) });
      },

      back() {
        const state = get();
        const tab = activeTabOf(state);
        const history = historyOf(state, tab?.id);
        if (!tab || !history || history.index <= 0) return;
        const url = history.entries[history.index - 1];
        if (url === undefined) return;
        set({
          tabs: withCurrentUrl(state.tabs, tab.id, url),
          histories: { ...state.histories, [tab.id]: { ...history, index: history.index - 1 } },
          navSeq: state.navSeq + 1,
        });
      },

      forward() {
        const state = get();
        const tab = activeTabOf(state);
        const history = historyOf(state, tab?.id);
        if (!tab || !history || history.index >= history.entries.length - 1) return;
        const url = history.entries[history.index + 1];
        if (url === undefined) return;
        set({
          tabs: withCurrentUrl(state.tabs, tab.id, url),
          histories: { ...state.histories, [tab.id]: { ...history, index: history.index + 1 } },
          navSeq: state.navSeq + 1,
        });
      },
    }),
    {
      name: 'nodus-portal-tabs-v1',
      version: 1,
      // Персистится только состав вкладок (без сессионных заголовков) и
      // активная; истории сессионные — после рестарта история вкладки =
      // её текущий адрес (фабрика historyOf).
      partialize: (state) => ({
        tabs: state.tabs.map(({ id, url, pinned }) => ({ id, url, pinned })),
        activeId: state.activeId,
      }),
      merge: zodPersistMerge<TabsState>(portalTabsEnvelopeSchema),
    },
  ),
);

/** Селекторы ◀▶ (подписка на выведенный boolean — лишних перерисовок нет). */
export function canBack(
  state: Pick<TabsState, 'tabs' | 'activeId' | 'histories'>,
  id: string | null,
): boolean {
  const history = historyOf(state, id);
  return !!history && history.index > 0;
}

export function canForward(
  state: Pick<TabsState, 'tabs' | 'activeId' | 'histories'>,
  id: string | null,
): boolean {
  const history = historyOf(state, id);
  return !!history && history.index < history.entries.length - 1;
}

/** Активная вкладка (для чтения вне React — контроллер, мост). */
export function activeTab(state: TabsState): PortalTab | undefined {
  return activeTabOf(state);
}
