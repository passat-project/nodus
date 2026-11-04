import type { RefObject } from 'react';

import { useBranchPanelWidth } from '../../../shared/ui/branch-panel.js';

/** Память ширины «ёлочки»: одна на все карточки писем; запомненная ширина
 *  ветки задачи читается запасной — панели одного калибра (канон #365). */
const STORE_KEY = 'nodus-letter-branch-w-v1';

/**
 * Ширина панели «Связи» (#461) — та же механика, что у ветки задачи (#365):
 * перегородка справа от панели тянет её императивно в rAF (карточка не
 * рендерится во время тяги), чат в каждом кадре получает ширину по формуле
 * рендера; память — localStorage, двойной клик — дефолт 300px.
 */
export function useLetterBranchWidth({
  rowRef,
  panelRef,
  chatRef,
}: {
  rowRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  chatRef: RefObject<HTMLDivElement | null>;
}) {
  return useBranchPanelWidth({
    storageKey: STORE_KEY,
    fallbackKeys: ['nodus-task-branch-w-v1'],
    rowRef,
    panelRef,
    chatRef,
  });
}
