import { MessageSquare, PanelRight } from 'lucide-react';
import type { ConversationListItem, TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { FileViewerBody } from '../../../shared/files/file-viewer-body.js';
import { FileTypeIcon } from '../../../shared/files/file-type-icon.js';
import { useViewerStore } from '../../../shared/files/viewer-store.js';
import { CardTabAreas } from '../../../shared/ui/entity-card/card-tab-areas.js';
import type { CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import type {
  CardTabGroup,
  CardTabsState,
} from '../../../shared/ui/entity-card/card-tabs-model.js';
import { TaskCardMenu } from './task-card-menu.js';
import { TaskDiscussion } from './task-discussion.js';
import { fileIdOf, fileTabId, type TaskTabId, type TaskTabsState } from '../lib/task-tabs.js';

/**
 * Правая зона карточки задачи (#746): общий движок областей вкладок.
 * «Чат» — постоянная вкладка, вложения — закрываемые; меню карточки и
 * «О задаче» — в правом слоте ПОСЛЕДНЕЙ области (там же, где раньше был
 * тоггл), а не в каждой полосе. Содержимое вкладок монтируется один раз и
 * переезжает между областями без ремаунта (лента/страница/зум живы).
 */
export function TaskCardSideTabs({
  task,
  tabs,
  conversation,
  aboutOpen,
  showAbout,
  state,
  groupW,
  collapsedGroupId,
  onStateChange,
  onSplitTab,
  onGroupWidthsChange,
  groupMin,
  hintText,
  onActivate,
  onClose,
  onToggleAbout,
}: {
  task: TaskDetail;
  tabs: TaskTabsState;
  conversation?: ConversationListItem;
  aboutOpen: boolean;
  showAbout: boolean;
  state: CardTabsState;
  groupW: number[];
  collapsedGroupId: string | null;
  onStateChange: (next: CardTabsState) => void;
  onSplitTab?: (next: CardTabsState, areaWidth: number) => void;
  onGroupWidthsChange: (widths: number[]) => void;
  groupMin?: (group: CardTabGroup) => number;
  /** Подсказка derived-состояния («О задаче» скрыта шириной) — хром полосы. */
  hintText?: string;
  onActivate: (tab: TaskTabId) => void;
  onClose: (fileId: string) => void;
  onToggleAbout: () => void;
}) {
  const openFullscreen = useViewerStore((s) => s.open);
  const stripTabs: CardTabDef[] = [
    {
      id: 'chat',
      label: ui.tasks.tabChat,
      icon: <MessageSquare className="size-3.5 shrink-0 opacity-80" />,
      badge: conversation?.unreadCount,
    },
    ...tabs.files.map((file) => ({
      id: fileTabId(file.fileId),
      label: file.name,
      icon: <FileTypeIcon mime={file.mime} className="size-3.5 shrink-0" />,
      title: file.name,
      closable: true,
    })),
  ];
  const lastGroupId = collapsedGroupId
    ? (state.groups.find((group) => group.id !== collapsedGroupId)?.id ?? null)
    : (state.groups[state.groups.length - 1]?.id ?? null);

  const panel = (tabId: string) => {
    if (tabId === 'chat') return <TaskDiscussion taskId={task.id} />;
    const fileId = fileIdOf(tabId as TaskTabId);
    const file = fileId ? tabs.files.find((entry) => entry.fileId === fileId) : undefined;
    return file ? (
      <FileViewerBody target={file} fit="width" onFullscreen={() => openFullscreen(file)} />
    ) : null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <CardTabAreas
        label={ui.tasks.tabsLabel}
        tabs={stripTabs}
        state={state}
        onSplitTab={onSplitTab}
        onStateChange={(next) => {
          onStateChange(next);
          // Хост-состояние файловых вкладок синхронно с движком: активная
          // вкладка области управляет MRU/закрытием соседа.
          const group =
            next.groups.find((entry) => entry.id === next.focusGroupId) ?? next.groups[0];
          if (group) onActivate(group.active as TaskTabId);
        }}
        renderPanel={panel}
        groupW={groupW}
        collapsedGroupId={collapsedGroupId}
        onGroupWidthsChange={onGroupWidthsChange}
        groupMin={groupMin}
        hintText={hintText}
        onCloseTab={(tabId) => {
          const fileId = fileIdOf(tabId as TaskTabId);
          if (fileId) onClose(fileId);
        }}
        canHideTab={() => false}
        actions={(group: CardTabGroup) =>
          group.id === lastGroupId ? (
            <>
              <TaskCardMenu task={task} />
              {showAbout ? (
                <button
                  type="button"
                  onClick={onToggleAbout}
                  aria-label={ui.tasks.aboutTask}
                  title={ui.tasks.aboutTask}
                  className={cn(
                    'shrink-0 rounded-lg p-2 transition-colors hover:bg-accent',
                    aboutOpen ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <PanelRight className="size-4" strokeWidth={1.75} />
                </button>
              ) : null}
            </>
          ) : null
        }
      />
    </div>
  );
}
