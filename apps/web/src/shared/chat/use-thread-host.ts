import { useEffect } from 'react';

import { useModalLayerCovered } from '../attention/modal-layers.js';
import { useSurfaceVisible } from '../lib/surface-visibility.js';
import { acquireOpenThread } from './open-thread.js';

/**
 * Хост окна треда (ThreadPane, #1072): открытое окно ИМЕННО этого треда —
 * область тишины для ответов в нём (гейт попапов/тостов). Видимость
 * поверхности и модальный слой — те же оси, что у useConversationHost
 * (#770/#809): накрытая карточка тред «не открывает».
 */
export function useThreadHost(conversationId: string, threadRootId: string): void {
  const surfaceVisible = useSurfaceVisible();
  const covered = useModalLayerCovered();
  useEffect(
    () =>
      surfaceVisible && !covered ? acquireOpenThread(conversationId, threadRootId) : undefined,
    [conversationId, threadRootId, surfaceVisible, covered],
  );
}
