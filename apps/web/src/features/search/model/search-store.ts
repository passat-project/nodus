import { create } from 'zustand';
import type { SearchSort, SearchSourceType } from '@nodus/contracts';

/**
 * Состояние единого поиска (#952): два состояния одного окна — компактное
 * Ctrl+K и рабочее внутри рамы, плюс общие фильтры. Стор живёт в features/search
 * и не персистится (в отличие от темы/меню): запрос — сессионное намерение.
 * Недавние запросы — отдельно, в localStorage на пользователя
 * (`search-recent.ts`).
 */
export type SearchMode = 'closed' | 'compact' | 'workspace';
export type SearchPeriod = 'any' | 'week' | 'month' | 'year';

/** Дни периода для `from` (фильтр по дате создания источника). */
export const SEARCH_PERIOD_DAYS: Record<Exclude<SearchPeriod, 'any'>, number> = {
  week: 7,
  month: 30,
  year: 365,
};

interface SearchState {
  mode: SearchMode;
  /** Строка запроса общая для обоих состояний: Ctrl+K из рабочего окна
   *  закрывает его, повторное открытие возвращает тот же запрос. */
  query: string;
  /** Пусто — все включённые типы (типы выключенных модулей сервер не отдаёт). */
  types: SearchSourceType[];
  projectId: string | null;
  period: SearchPeriod;
  sort: SearchSort;
  /** Ctrl+K: открыть компакт или закрыть любое состояние (вердикт Д2). */
  toggleCompact: () => void;
  openCompact: () => void;
  openWorkspace: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  toggleType: (type: SearchSourceType) => void;
  clearTypes: () => void;
  setProjectId: (projectId: string | null) => void;
  setPeriod: (period: SearchPeriod) => void;
  setSort: (sort: SearchSort) => void;
  resetFilters: () => void;
}

export const useSearchStore = create<SearchState>()((set) => ({
  mode: 'closed',
  query: '',
  types: [],
  projectId: null,
  period: 'any',
  sort: 'relevance',
  toggleCompact: () => set((state) => ({ mode: state.mode === 'closed' ? 'compact' : 'closed' })),
  openCompact: () => set({ mode: 'compact' }),
  // Запрос и фильтры переезжают из компакта в рабочее окно как есть.
  openWorkspace: () => set({ mode: 'workspace' }),
  close: () => set({ mode: 'closed' }),
  setQuery: (query) => set({ query }),
  toggleType: (type) =>
    set((state) => ({
      types: state.types.includes(type)
        ? state.types.filter((item) => item !== type)
        : [...state.types, type],
    })),
  clearTypes: () => set({ types: [] }),
  setProjectId: (projectId) => set({ projectId }),
  setPeriod: (period) => set({ period }),
  setSort: (sort) => set({ sort }),
  resetFilters: () => set({ types: [], projectId: null, period: 'any', sort: 'relevance' }),
}));
