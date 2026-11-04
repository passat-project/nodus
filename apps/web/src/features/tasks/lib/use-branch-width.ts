import type { RefObject } from 'react';

import { useBranchPanelWidth } from '../../../shared/ui/branch-panel.js';

const STORE_KEY = 'nodus-task-branch-w-v1';

/**
 * Ширина навигатора ветки карточки задачи с перегородкой и памятью (#365).
 * Механика — общая `useBranchPanelWidth` (та же, что у «ёлочки» письма
 * #461): drag императивный в rAF, коммит на pointerup, двойной клик —
 * дефолт. Память задачи — свой ключ (общий ключ писем читается как
 * запасной: панели одного калибра).
 */
export function useBranchWidth({
  rowRef,
  branchRef,
  chatRef,
}: {
  rowRef: RefObject<HTMLDivElement | null>;
  branchRef: RefObject<HTMLDivElement | null>;
  chatRef: RefObject<HTMLDivElement | null>;
}) {
  return useBranchPanelWidth({
    storageKey: STORE_KEY,
    fallbackKeys: ['nodus-letter-branch-w-v1'],
    rowRef,
    panelRef: branchRef,
    chatRef,
  });
}
