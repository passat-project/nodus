import { create } from 'zustand';
import type { SearchSort, SearchSourceType } from '@nodus/contracts';

/**
 * Состояние единого поиска (#952): ОДНО компактное окно Ctrl+K с панелью
 * фильтров слева (решение владельца 18.11.2026 — рабочего листа нет). Стор
 * живёт в features/search и не персистится (в отличие от темы/меню): запрос —
 * сессионное намерение. Недавние запросы — отдельно, в localStorage на
 * пользователя (`search-recent.ts`).
 */
export type SearchPeriod = 'any' | 'week' | 'month' | 'year';

/** Дни периода для `from` (фильтр по дате создания источника). */
export const SEARCH_PERIOD_DAYS: Record<Exclude<SearchPeriod, 'any'>, number> = {
  week: 7,
  month: 30,
  year: 365,
};

interface SearchState {
  open: boolean;
  /** Сессионное намерение: закрытие окна очищает строку (вердикт владельца 18.11.2026). */
  query: string;
  /** Пусто — все включённые типы (типы выключенных модулей сервер не отдаёт). */
  types: SearchSourceType[];
  projectId: string | null;
  period: SearchPeriod;
  sort: SearchSort;
  /** Ctrl+K: открыть окно поиска или закрыть его. */
  toggle: () => void;
  openSearch: () => void;
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
  open: false,
  query: '',
  types: [],
  projectId: null,
  period: 'any',
  sort: 'relevance',
  // Закрытие сбрасывает строку: повторный Ctrl+K — чистое окно (фильтры
  // остаются видимыми в панели — это состояние экрана, а не намерение).
  toggle: () => set((state) => (state.open ? { open: false, query: '' } : { open: true })),
  openSearch: () => set({ open: true }),
  close: () => set({ open: false, query: '' }),
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
