import { useEffect, type Dispatch, type SetStateAction } from 'react';

import type { CardTabGroup } from '../../../shared/ui/entity-card/card-tabs-model.js';
import { activateTab, initialTabs, type LetterTabId, type LetterTabsState } from './letter-tabs.js';

/**
 * Хост файлового MRU показывает ту же активную вкладку, что восстановил
 * движок из prefs (#745/#746): иначе полоса стоит на «Чате», а плитка
 * основного документа подсвечена как активная. При ещё не созданном
 * host-состоянии инициализируем его восстановленной активной.
 */
export function useLetterHostActive(
  groups: readonly CardTabGroup[],
  focusGroupId: string | null,
  hostActive: LetterTabId | undefined,
  setTabsState: Dispatch<SetStateAction<LetterTabsState | null>>,
): void {
  useEffect(() => {
    const group = groups.find((entry) => entry.id === focusGroupId) ?? groups[0];
    const active = group?.active as LetterTabId | undefined;
    if (!active || active === hostActive) return;
    setTabsState((current) => (current ? activateTab(current, active) : initialTabs(active)));
  }, [focusGroupId, groups, hostActive, setTabsState]);
}
