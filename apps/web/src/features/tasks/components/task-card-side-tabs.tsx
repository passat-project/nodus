import { MessageSquare, PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConversationListItem, TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { FileViewerBody } from '../../../shared/files/file-viewer-body.js';
import { FileTypeIcon } from '../../../shared/files/file-type-icon.js';
import { useViewerStore } from '../../../shared/files/viewer-store.js';
import { CardTabStrip, type CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { TaskCardMenu } from './task-card-menu.js';
import { TaskDiscussion } from './task-discussion.js';
import { fileIdOf, fileTabId, type TaskTabId, type TaskTabsState } from '../lib/task-tabs.js';

/**
 * Правая зона карточки задачи (редизайн 04.11.2026): общая полоса вкладок
 * карточек (`CardTabStrip`, фон карточки — как в проекте и письме). «Чат» —
 * постоянная вкладка по умолчанию; вложения — закрываемые вкладки, открытые
 * просмотрщиком ONLYOFFICE (`FileViewerBody`); «Открыть на весь экран» —
 * внутри вкладки-файла, у зума вложения. Меню карточки и «О задаче» — в
 * правом слоте полосы. Содержимое вкладки монтируется при первом показе и
 * живёт скрытым (`invisible` + `inert`): лента, страница и масштаб документа
 * не теряются.
 */
export function TaskCardSideTabs({
  task,
  tabs,
  conversation,
  aboutOpen,
  showAbout,
  onActivate,
  onClose,
  onToggleAbout,
}: {
  task: TaskDetail;
  tabs: TaskTabsState;
  /** Беседа задачи — счётчик непрочитанного на «Чате». */
  conversation?: ConversationListItem;
  aboutOpen: boolean;
  /** Скрыт чат — нет тоггла панели «О задаче» (Р7). */
  showAbout: boolean;
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <CardTabStrip
        label={ui.tasks.tabsLabel}
        tabs={stripTabs}
        active={tabs.active}
        onActivate={(id) => onActivate(id as TaskTabId)}
        onClose={(id) => {
          const fileId = fileIdOf(id as TaskTabId);
          if (fileId) onClose(fileId);
        }}
        actions={
          <>
            <TaskCardMenu task={task} />
            {showAbout ? (
              <UtilityButton
                label={ui.tasks.aboutTask}
                active={aboutOpen}
                onClick={onToggleAbout}
                icon={<PanelRight className="size-4" strokeWidth={1.75} />}
              />
            ) : null}
          </>
        }
      />
      <div className="relative min-h-0 flex-1">
        <TaskTabPanel active={tabs.active === 'chat'}>
          <TaskDiscussion taskId={task.id} />
        </TaskTabPanel>
        {tabs.files.map((file) => (
          <TaskTabPanel key={file.fileId} active={tabs.active === fileTabId(file.fileId)}>
            <FileViewerBody target={file} fit="width" onFullscreen={() => openFullscreen(file)} />
          </TaskTabPanel>
        ))}
      </div>
    </div>
  );
}

function UtilityButton({
  label,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'shrink-0 rounded-lg p-2 transition-colors hover:bg-accent',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {icon}
    </button>
  );
}

function TaskTabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" inert={!active} className={cn('absolute inset-0', !active && 'invisible')}>
      {children}
    </div>
  );
}
