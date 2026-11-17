import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ViewFieldPrefs, ViewSort } from '@nodus/contracts';

import { viewsEnvelopeSchema, zodPersistMerge } from '../lib/persist-zod.js';
import { useAuthStore } from '../auth-store.js';

/**
 * Персональные настройки представлений всех модулей (схема — contracts
 * viewPresetSchema; на проде — API персонализации, §10.5). Ключ вида:
 * '<module>.<view>' ('tasks.list', 'tasks.kanban', 'letters.list'…).
 * sorts — активная сортировка списка (концепт #4: одна колонка, ↑/↓).
 *
 * Хранение — ключ НА ПОЛЬЗОВАТЕЛЯ (`nodus-views-v2:<userId>`, #876/AUD-005):
 * на общем компьютере настройка колонок одного сотрудника не применяется
 * другому. Общий ключ `nodus-views-v2` (без пользователя) больше не читается —
 * legacy-значение игнорируется и вычищается при сбросе сессии.
 */
interface ViewState {
  views: Record<string, Record<string, ViewFieldPrefs>>;
  sorts: Record<string, ViewSort>;
  setFieldVisible: (view: string, field: string, visible: boolean) => void;
  setFieldWidth: (view: string, field: string, width: number) => void;
  /** Порядок колонок (drag за заголовок): entries — ПОЛНЫЙ список полей вида
   *  (видимые в новом порядке + скрытые следом) с их ТЕКУЩЕЙ видимостью.
   *  Видимость НЕ насилуется: сохранённая побеждает, без сохранённой —
   *  текущая из реестра (урок 15.09.2026: дефолт visible:true воскрешал
   *  все скрытые по умолчанию поля на первом drag колонки). */
  applyOrder: (view: string, entries: { id: string; visible: boolean }[]) => void;
  setSort: (view: string, sort: ViewSort) => void;
  resetView: (view: string) => void;
}

const STORE_NAME = 'nodus-views-v2';
const USERLESS_KEY = 'anonymous';

/** Ключ настроек колонок конкретного пользователя (#876): без пользователя —
 *  только до входа (`anonymous`); legacy-ключ без суффикса не читается. */
export function viewsStorageKey(userId: string | null): string {
  return `${STORE_NAME}:${userId ?? USERLESS_KEY}`;
}

const userScopedStorage = createJSONStorage<Pick<ViewState, 'views' | 'sorts'>>(() => ({
  getItem: () => localStorage.getItem(viewsStorageKey(useAuthStore.getState().user?.id ?? null)),
  setItem: (_name: string, value: string) =>
    localStorage.setItem(viewsStorageKey(useAuthStore.getState().user?.id ?? null), value),
  removeItem: () =>
    localStorage.removeItem(viewsStorageKey(useAuthStore.getState().user?.id ?? null)),
}));

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      views: {},
      sorts: {},
      setFieldVisible: (view, field, visible) =>
        set((s) => ({
          views: {
            ...s.views,
            [view]: { ...s.views[view], [field]: { ...s.views[view]?.[field], visible } },
          },
        })),
      setFieldWidth: (view, field, width) =>
        set((s) => ({
          views: {
            ...s.views,
            [view]: {
              ...s.views[view],
              [field]: { visible: true, ...s.views[view]?.[field], width },
            },
          },
        })),
      applyOrder: (view, entries) =>
        set((s) => ({
          views: {
            ...s.views,
            [view]: {
              ...s.views[view],
              ...Object.fromEntries(
                entries.map((e, i) => [
                  e.id,
                  {
                    visible: e.visible,
                    ...s.views[view]?.[e.id],
                    order: i,
                  } satisfies ViewFieldPrefs,
                ]),
              ),
            },
          },
        })),
      setSort: (view, sort) => set((s) => ({ sorts: { ...s.sorts, [view]: sort } })),
      resetView: (view) =>
        set((s) => {
          const next = { ...s.views };
          delete next[view];
          const nextSorts = { ...s.sorts };
          delete nextSorts[view];
          return { views: next, sorts: nextSorts };
        }),
    }),
    {
      name: STORE_NAME,
      version: 1,
      storage: userScopedStorage,
      partialize: (state) => ({ views: state.views, sorts: state.sorts }),
      merge: zodPersistMerge<ViewState>(viewsEnvelopeSchema),
    },
  ),
);

/** Кэш настроек колонок ИМЕННО этого пользователя (не через rehydrate:
 *  очистка перед rehydrate записала бы пустой envelope в ключ нового
 *  пользователя и стёрла его кэш — та же гонка, что в ui-prefs). */
export function readScopedViews(userId: string | null): Pick<ViewState, 'views' | 'sorts'> {
  try {
    const raw = localStorage.getItem(viewsStorageKey(userId));
    if (!raw) return { views: {}, sorts: {} };
    const parsed = JSON.parse(raw) as { state?: unknown };
    const envelope = viewsEnvelopeSchema.safeParse(parsed.state);
    return envelope.success
      ? { views: envelope.data.views, sorts: envelope.data.sorts }
      : { views: {}, sorts: {} };
  } catch {
    return { views: {}, sorts: {} };
  }
}

/** Сброс сессии (AUD-005): legacy-ключ без пользователя больше не читается,
 *  но личные данные в нём остались — убираем. Ключи пользователей не трогаем:
 *  чужой не применится, а повторный вход должен быть быстрым. */
export function clearLegacyViewsStorage(): void {
  try {
    // Только ровно legacy-имя: `nodus-views-v2:<userId>` — это кэш людей.
    localStorage.removeItem(STORE_NAME);
  } catch {
    // localStorage недоступен (приватный режим) — чистить нечего.
  }
}
