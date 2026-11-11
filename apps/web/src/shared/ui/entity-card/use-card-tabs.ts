import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardKind, CardTabsPref } from '@nodus/contracts';

import { useUiPrefsStore } from '../../preferences/ui-prefs-store.js';
import { createCardTabsState, normalizeGroups, type CardTabsState } from './card-tabs-model.js';
import {
  groupsFromPref,
  hiddenFromPref,
  isFileTabId,
  legacyPrefFor,
  markLegacyMigrated,
  prefFromState,
  toggleHiddenTab,
} from './card-tabs-prefs.js';

export interface CardTabsWidths {
  data?: number;
  groups?: number[];
}

export interface UseCardTabsOptions {
  kind: CardKind;
  /** Стабильные вкладки вида в системном порядке (до скрытия). */
  stableTabs: readonly string[];
  /** Открытые файловые вкладки (runtime `file:<id>`), сессионные. */
  fileTabs?: readonly string[];
  /** Дефолтная активная, если личного порядка ещё нет (проект — structure,
   *  задача — chat, письмо — body/chat по наличию документа). */
  defaultActive?: string;
  /** Активная вкладка, которой управляет хост (файл открыт/закрыт). */
  requestedActive?: string;
}

function rebuild(
  pref: CardTabsPref | undefined,
  options: UseCardTabsOptions,
  hidden: string[],
  previous?: CardTabsState,
): CardTabsState {
  const groups = groupsFromPref(pref, {
    stableTabs: options.stableTabs,
    fileTabs: options.fileTabs ?? [],
    hidden,
  });
  const activeHint = previous
    ? groups.flatMap((group) => group.tabs).find((id) => previous.visited[id])
    : options.defaultActive;
  return createCardTabsState(groups, {
    activeTab: activeHint,
    visited: previous ? Object.keys(previous.visited) : [],
    focusGroupId: previous?.focusGroupId ?? null,
  });
}

/**
 * Состояние областей вкладок карточки (#746) + личные настройки (#745).
 * Хост даёт стабильные вкладки и файловые (runtime); хук:
 * - восстанавливает порядок/области/активные/ширины из `personal.cardTabs`;
 * - мигрирует старые ключи (скрытые проекта, ширина чата) один раз;
 * - пишет каждое изменение в стор оптимистично (I4) — дальше debounce PUT;
 * - скрывает вкладки через «+», не давая скрыть последнюю видимую;
 * - пересобирает состав при изменении файловых вкладок (id файлов в prefs
 *   не попадают — только плейсхолдер `files`).
 */
export function useCardTabs(options: UseCardTabsOptions) {
  const storedPref = useUiPrefsStore((state) => state.personal.cardTabs?.[options.kind]);
  const setCardTabs = useUiPrefsStore((state) => state.setCardTabs);
  // Миграция старых ключей читается один раз на монтирование вида.
  const migratedRef = useRef<CardTabsPref | undefined>(undefined);
  if (migratedRef.current === undefined && !storedPref) {
    migratedRef.current = legacyPrefFor(options.kind, options.stableTabs, options.defaultActive);
  }
  const initialPref = storedPref ?? migratedRef.current;

  const [hidden, setHidden] = useState<string[]>(() =>
    hiddenFromPref(initialPref, options.stableTabs),
  );
  const [widths, setWidths] = useState<CardTabsWidths>(() => initialPref?.widths ?? {});
  const [panelOpen, setPanelOpen] = useState<boolean>(() => initialPref?.panelOpen ?? false);
  const [state, setState] = useState<CardTabsState>(() =>
    rebuild(initialPref, options, hiddenFromPref(initialPref, options.stableTabs)),
  );

  // Успешная миграция: записываем prefs и ставим флаг (старые ключи не
  // удаляем — данные пользователя остаются до явной очистки).
  useEffect(() => {
    if (storedPref || !migratedRef.current) {
      markLegacyMigrated(options.kind);
      return;
    }
    const pref = prefFromState(state, { hidden, widths, panelOpen });
    if (pref) setCardTabs(options.kind, pref);
    markLegacyMigrated(options.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- миграция один раз на монтирование
  }, []);

  // Файлы открылись/закрылись: пересобрать состав, сохранив порядок
  // стабильных вкладок и посещённые панели. Id файлов в prefs не пишем.
  const fileKey = (options.fileTabs ?? []).join('|');
  const fileKeyRef = useRef(fileKey);
  useEffect(() => {
    if (fileKeyRef.current === fileKey) return;
    fileKeyRef.current = fileKey;
    setState((previous) => {
      const pref = prefFromState(previous, { hidden, widths, panelOpen }) ?? undefined;
      const groups = groupsFromPref(pref, {
        stableTabs: options.stableTabs,
        fileTabs: options.fileTabs ?? [],
        hidden,
      });
      const activeFile = options.requestedActive;
      const active =
        activeFile && isFileTabId(activeFile) && groups.some((g) => g.tabs.includes(activeFile))
          ? activeFile
          : undefined;
      return createCardTabsState(groups, {
        activeTab: active,
        visited: Object.keys(previous.visited),
        focusGroupId: previous.focusGroupId,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- файловый состав
  }, [fileKey]);

  // Хост открыл вкладку (файл/стартовую письма) — активировать её в движке.
  useEffect(() => {
    if (!options.requestedActive) return;
    setState((previous) =>
      previous.groups.some((group) => group.tabs.includes(options.requestedActive!))
        ? activateIn(previous, options.requestedActive!)
        : previous,
    );
  }, [options.requestedActive]);

  // Внешнее обновление prefs (серверный GET после логина, другой таб) может
  // прийти ПОЗЖЕ маунта карточки — тогда локальное состояние уже собрано по
  // пустым prefs. Применяем новое значение, если оно отличается от текущего:
  // свои же записи (setCardTabs) сюда возвращаются равными и no-op'ятся.
  const currentPrefKey = useMemo(() => {
    const pref = prefFromState(state, { hidden, widths, panelOpen });
    return pref ? JSON.stringify(pref) : '';
  }, [hidden, panelOpen, state, widths]);
  useEffect(() => {
    if (!storedPref) return;
    if (JSON.stringify(storedPref) === currentPrefKey) return;
    const nextHidden = hiddenFromPref(storedPref, options.stableTabs);
    setHidden(nextHidden);
    setWidths(storedPref.widths ?? {});
    setPanelOpen(Boolean(storedPref.panelOpen));
    setState((previous) => {
      const groups = groupsFromPref(storedPref, {
        stableTabs: options.stableTabs,
        fileTabs: options.fileTabs ?? [],
        hidden: nextHidden,
      });
      return createCardTabsState(groups, {
        activeTab: options.requestedActive ?? options.defaultActive,
        visited: Object.keys(previous.visited),
        focusGroupId: previous.focusGroupId,
      });
    });
  }, [
    currentPrefKey,
    options.defaultActive,
    options.fileTabs,
    options.requestedActive,
    options.stableTabs,
    storedPref,
  ]);

  const persist = useCallback(
    (
      nextState: CardTabsState,
      nextHidden: string[],
      nextWidths: CardTabsWidths,
      nextPanelOpen: boolean,
    ) => {
      const pref = prefFromState(nextState, {
        hidden: nextHidden,
        widths: nextWidths,
        panelOpen: nextPanelOpen,
      });
      if (pref) setCardTabs(options.kind, pref);
    },
    [options.kind, setCardTabs],
  );

  const updateState = useCallback(
    (next: CardTabsState) => {
      // Соединили области — пиксельные ширины двух областей больше не нужны:
      // иначе следующая область унаследует старые пропорции.
      const nextWidths =
        next.groups.length === 1 && widths.groups?.length
          ? { ...widths, groups: undefined }
          : widths;
      setState(next);
      if (nextWidths !== widths) setWidths(nextWidths);
      persist(next, hidden, nextWidths, panelOpen);
    },
    [hidden, panelOpen, persist, widths],
  );

  /** Сплит активной вкладки: новая область сразу забирает половину рабочей
   *  зоны (issue #746), исходная сохраняет остаток — без «остаток последней»
   *  из solver'а, который отдал бы новой области 2/3 ширины. */
  const splitIntoTwo = useCallback(
    (next: CardTabsState, areaWidth: number) => {
      if (next.groups.length < 2 || areaWidth <= 0) {
        updateState(next);
        return;
      }
      const left = Math.round(areaWidth / 2);
      const nextWidths: CardTabsWidths = { ...widths, groups: [left, areaWidth - left] };
      setState(next);
      setWidths(nextWidths);
      persist(next, hidden, nextWidths, panelOpen);
    },
    [hidden, panelOpen, persist, updateState, widths],
  );

  const setGroupWidths = useCallback(
    (groups: number[]) => {
      const next = { ...widths, groups };
      setWidths(next);
      persist(state, hidden, next, panelOpen);
    },
    [hidden, panelOpen, persist, state, widths],
  );

  const setDataWidth = useCallback(
    (data: number) => {
      const next = { ...widths, data: Math.round(data) };
      setWidths(next);
      persist(state, hidden, next, panelOpen);
    },
    [hidden, panelOpen, persist, state, widths],
  );

  const setPanelOpenPersisted = useCallback(
    (open: boolean) => {
      setPanelOpen(open);
      persist(state, hidden, widths, open);
    },
    [hidden, persist, state, widths],
  );

  const toggleHidden = useCallback(
    (tabId: string) => {
      const nextHidden = toggleHiddenTab(hidden, tabId, options.stableTabs);
      if (
        nextHidden.length === hidden.length &&
        nextHidden.every((id, index) => id === hidden[index])
      ) {
        return;
      }
      setHidden(nextHidden);
      setState((previous) => {
        const groups = groupsFromPref(
          prefFromState(previous, { hidden: nextHidden, widths, panelOpen }) ?? undefined,
          {
            stableTabs: options.stableTabs,
            fileTabs: options.fileTabs ?? [],
            hidden: nextHidden,
          },
        );
        const next = createCardTabsState(groups, {
          visited: Object.keys(previous.visited),
          focusGroupId: previous.focusGroupId,
        });
        persist(next, nextHidden, widths, panelOpen);
        return next;
      });
    },
    [hidden, options, panelOpen, persist, widths],
  );

  const visibleTabs = useMemo(
    () => [...options.stableTabs.filter((id) => !hidden.includes(id)), ...(options.fileTabs ?? [])],
    [hidden, options.fileTabs, options.stableTabs],
  );

  // Скрытые вкладки не должны оставаться в группах (например, после
  // серверной гидратации/миграции).
  useEffect(() => {
    setState((previous) => {
      const groups = normalizeGroups(
        previous.groups.map((group) => ({
          ...group,
          tabs: group.tabs.filter((id) => !hidden.includes(id)),
        })),
        visibleTabs,
        2,
        visibleTabs[0],
      );
      if (
        groups.length === previous.groups.length &&
        groups.every((g, i) => g.tabs.join() === previous.groups[i]?.tabs.join())
      )
        return previous;
      return createCardTabsState(groups, {
        visited: Object.keys(previous.visited),
        focusGroupId: previous.focusGroupId,
      });
    });
  }, [hidden, visibleTabs]);

  return {
    state,
    setState: updateState,
    splitIntoTwo,
    hidden,
    toggleHidden,
    visibleTabs,
    widths,
    setGroupWidths,
    setDataWidth,
    panelOpen,
    setPanelOpen: setPanelOpenPersisted,
    pref: storedPref,
  };
}

function activateIn(state: CardTabsState, tabId: string): CardTabsState {
  const group = state.groups.find((entry) => entry.tabs.includes(tabId));
  if (!group) return state;
  return {
    ...state,
    groups: state.groups.map((entry) =>
      entry.id === group.id ? { ...entry, active: tabId } : entry,
    ),
    visited: { ...state.visited, [tabId]: true },
    focusGroupId: group.id,
  };
}
