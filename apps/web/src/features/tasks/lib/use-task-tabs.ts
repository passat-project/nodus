import { useCallback, useState } from 'react';

import type { ViewerTarget } from '../../../shared/files/viewer-store.js';
import {
  activateTaskTab,
  closeTaskFileTab,
  initialTaskTabs,
  openTaskFileTab,
  type TaskTabId,
  type TaskTabsState,
} from './task-tabs.js';

/** Состояние вкладок правой зоны карточки задачи. При переходе к связанной
 *  задаче (замена верхней карточки без ремаунта) вкладки сбрасываются к
 *  «Чату» — вложения принадлежали прежней беседе. */
export function useTaskTabs(taskId: string) {
  const [tabs, setTabs] = useState<TaskTabsState>(initialTaskTabs);
  const [tabsFor, setTabsFor] = useState(taskId);
  if (tabsFor !== taskId) {
    setTabsFor(taskId);
    setTabs(initialTaskTabs());
  }
  const openFile = useCallback((target: ViewerTarget) => {
    setTabs((state) => openTaskFileTab(state, target));
  }, []);
  const closeFile = useCallback((fileId: string) => {
    setTabs((state) => closeTaskFileTab(state, fileId));
  }, []);
  const activateTab = useCallback((tab: TaskTabId) => {
    setTabs((state) => activateTaskTab(state, tab));
  }, []);
  return { tabs, openFile, closeFile, activateTab };
}
