import { useCallback, useMemo, useState } from 'react';

import { getCurrentUserId } from '../lib/current-user-id.js';
import { listFiltersStorageKey } from './list-filters-storage.js';
import { applyListFilters, type ActiveListFilter, type FilterState } from './list-filters.js';

/** Пресет фильтра (модель Битрикс24): имя + состояние полей. Встроенные
 *  («В работе», «Просрочены»…) — из реестра сущности; пользовательские —
 *  сохраняются локально. «Скрепка» (pinnedId) — применяется по умолчанию. */
export interface FilterPreset {
  id: string;
  name: string;
  state: FilterState;
}

interface StoredView {
  filters: FilterState;
  presets: FilterPreset[];
  pinnedId?: string;
}

function load(storageKey: string): StoredView {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { filters: {}, presets: [] };
    const parsed = JSON.parse(raw) as {
      filters?: FilterState;
      presets?: (FilterPreset & { pinned?: boolean })[];
      pinnedId?: string;
    };
    const presets = Array.isArray(parsed.presets) ? parsed.presets : [];
    // Миграция v1: «скрепка» жила флагом на пресете → теперь pinnedId.
    const pinnedId = parsed.pinnedId ?? presets.find((p) => p.pinned)?.id;
    return {
      filters: parsed.filters ?? {},
      presets: presets.map(({ id, name, state }) => ({ id, name, state })),
      pinnedId,
    };
  } catch {
    return { filters: {}, presets: [] };
  }
}

function save(storageKey: string, value: StoredView) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // приватный режим / квота — фильтры просто не запомнятся
  }
}

/** Состояние локального поиска и фильтров списка (память между сессиями, как
 *  ширины колонок и отображаемые поля). Запрос (поиск) — не персистится:
 *  эфемерен по смыслу. При открытии списка закреплённый пресет (встроенный
 *  или сохранённый) применяется по умолчанию, иначе — последние фильтры. */
export function useListToolbar(viewKey: string, builtinPresets: FilterPreset[] = []) {
  // Ключ — на пользователя (AUD-005): сохранённые фильтры одного сотрудника
  // не применяются следующему вошедшему на общем компьютере.
  const storageKey = listFiltersStorageKey(getCurrentUserId(), viewKey);
  const [stored, setStored] = useState<StoredView>(() => {
    const initial = load(storageKey);
    const pinned =
      builtinPresets.find((p) => p.id === initial.pinnedId) ??
      initial.presets.find((p) => p.id === initial.pinnedId);
    return pinned ? { ...initial, filters: pinned.state } : initial;
  });
  const [query, setQuery] = useState('');

  const update = useCallback(
    (next: StoredView) => {
      setStored(next);
      save(storageKey, next);
    },
    [storageKey],
  );

  const setFilter = useCallback(
    (id: string, value: FilterState[string]) => {
      const filters = { ...stored.filters };
      if (
        value === undefined ||
        value === '' ||
        (typeof value === 'object' && value.from === undefined && value.to === undefined)
      ) {
        delete filters[id];
      } else {
        filters[id] = value;
      }
      update({ ...stored, filters });
    },
    [stored, update],
  );

  /** Применить состояние целиком (клик по пресету в панели). */
  const setFilters = useCallback(
    (state: FilterState) => update({ ...stored, filters: { ...state } }),
    [stored, update],
  );

  const resetAll = useCallback(() => update({ ...stored, filters: {} }), [stored, update]);

  const savePreset = useCallback(
    (name: string) => {
      const preset: FilterPreset = { id: crypto.randomUUID(), name, state: stored.filters };
      update({ ...stored, presets: [...stored.presets, preset] });
    },
    [stored, update],
  );

  const deletePreset = useCallback(
    (id: string) => {
      update({
        ...stored,
        presets: stored.presets.filter((p) => p.id !== id),
        pinnedId: stored.pinnedId === id ? undefined : stored.pinnedId,
      });
    },
    [stored, update],
  );

  /** «Скрепка»: единственный закреплённый пресет; повторный клик — открепить. */
  const togglePin = useCallback(
    (id: string) => {
      update({ ...stored, pinnedId: stored.pinnedId === id ? undefined : id });
    },
    [stored, update],
  );

  return useMemo(
    () => ({
      query,
      setQuery,
      filters: stored.filters,
      setFilter,
      setFilters,
      resetAll,
      presets: stored.presets,
      pinnedId: stored.pinnedId,
      savePreset,
      deletePreset,
      togglePin,
    }),
    [
      query,
      stored.filters,
      stored.presets,
      stored.pinnedId,
      setFilter,
      setFilters,
      resetAll,
      savePreset,
      deletePreset,
      togglePin,
    ],
  );
}

export type ListToolbarState = ReturnType<typeof useListToolbar>;

/** Отфильтрованный список потребителя (memo): без фильтра — копия исходного. */
export function useFilteredList<T>(items: readonly T[], filter?: ActiveListFilter<T>): T[] {
  return useMemo(
    () =>
      filter
        ? applyListFilters(items, filter.defs, filter.state, filter.query, filter.searchText)
        : [...items],
    [items, filter],
  );
}
