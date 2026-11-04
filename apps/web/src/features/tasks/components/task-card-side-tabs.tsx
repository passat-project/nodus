import { Maximize2, MessageSquare, PanelRight, Waypoints, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConversationListItem, TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { FileViewerBody } from '../../../shared/files/file-viewer-body.js';
import { FileTypeIcon } from '../../../shared/files/file-type-icon.js';
import { useViewerStore } from '../../../shared/files/viewer-store.js';
import { TaskCardMenu } from './task-card-menu.js';
import { TaskDiscussion } from './task-discussion.js';
import { fileIdOf, fileTabId, type TaskTabId, type TaskTabsState } from '../lib/task-tabs.js';

/**
 * Правая зона карточки задачи (редизайн 04.11.2026): полоса вкладок на
 * верхнем уровне — как в карточке проекта (h-10, иконка + подпись, активная
 * `border-port`). «Чат» — постоянная вкладка по умолчанию; вложения —
 * закрываемые вкладки, открытые просмотрщиком ONLYOFFICE (`FileViewerBody`),
 * с действием «Открыть на весь экран» (общая модалка). Утилиты прежней
 * полосы цепочки (ветка, меню, «О задаче») — у правого края полосы.
 * Содержимое вкладки монтируется при первом показе и живёт скрытым
 * (`invisible` + `inert`): лента, страница и масштаб документа не теряются.
 */
export function TaskCardSideTabs({
  task,
  tabs,
  conversation,
  branchOpen,
  aboutOpen,
  showBranch,
  showAbout,
  onActivate,
  onClose,
  onToggleBranch,
  onToggleAbout,
}: {
  task: TaskDetail;
  tabs: TaskTabsState;
  /** Беседа задачи — счётчик непрочитанного на «Чате». */
  conversation?: ConversationListItem;
  branchOpen: boolean;
  aboutOpen: boolean;
  /** Скрыты и подзадачи, и связи — переключателя навигатора нет (#432, Р7). */
  showBranch: boolean;
  /** Скрыт чат — нет тоггла панели «О задаче» (Р7). */
  showAbout: boolean;
  onActivate: (tab: TaskTabId) => void;
  onClose: (fileId: string) => void;
  onToggleBranch: () => void;
  onToggleAbout: () => void;
}) {
  const openFullscreen = useViewerStore((s) => s.open);
  const activeFile = tabs.files.find((file) => file.fileId === fileIdOf(tabs.active)) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center border-b border-border">
        <div
          role="tablist"
          aria-label={ui.tasks.tabsLabel}
          className="content-fade flex h-10 min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden px-3"
        >
          <TaskTab
            active={tabs.active === 'chat'}
            icon={<MessageSquare className="size-3.5 shrink-0 opacity-80" />}
            label={ui.tasks.tabChat}
            badge={conversation?.unreadCount}
            onActivate={() => onActivate('chat')}
          />
          {tabs.files.map((file) => (
            <TaskTab
              key={file.fileId}
              active={tabs.active === fileTabId(file.fileId)}
              icon={<FileTypeIcon mime={file.mime} className="size-3.5 shrink-0" />}
              label={file.name}
              title={file.name}
              onActivate={() => onActivate(fileTabId(file.fileId))}
              onClose={() => onClose(file.fileId)}
            />
          ))}
        </div>
        <div className="flex h-10 shrink-0 items-center gap-1 pr-2">
          {showBranch ? (
            <UtilityButton
              label={ui.tasks.branch}
              active={branchOpen}
              onClick={onToggleBranch}
              icon={<Waypoints className="size-4" strokeWidth={1.75} />}
            />
          ) : null}
          {activeFile ? (
            <UtilityButton
              label={ui.tasks.openFullscreen}
              onClick={() => openFullscreen(activeFile)}
              icon={<Maximize2 className="size-4" strokeWidth={1.75} />}
            />
          ) : null}
          <TaskCardMenu task={task} />
          {showAbout ? (
            <UtilityButton
              label={ui.tasks.aboutTask}
              active={aboutOpen}
              onClick={onToggleAbout}
              icon={<PanelRight className="size-4" strokeWidth={1.75} />}
            />
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <TaskTabPanel active={tabs.active === 'chat'}>
          <TaskDiscussion taskId={task.id} />
        </TaskTabPanel>
        {tabs.files.map((file) => (
          <TaskTabPanel key={file.fileId} active={tabs.active === fileTabId(file.fileId)}>
            <FileViewerBody target={file} fit="width" />
          </TaskTabPanel>
        ))}
      </div>
    </div>
  );
}

function TaskTab({
  active,
  icon,
  label,
  title,
  badge,
  onActivate,
  onClose,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  title?: string;
  badge?: number;
  onActivate: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center border-b-2 transition-colors',
        active
          ? 'border-port text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground/80',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={title}
        onClick={onActivate}
        className={cn(
          'flex h-full max-w-48 min-w-0 items-center gap-1.5 text-body-xs font-medium focus-visible:outline-2 focus-visible:outline-ring',
          onClose ? 'pr-1 pl-2' : 'px-2.5',
        )}
      >
        <span aria-hidden className="shrink-0 opacity-80">
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {badge && !active ? (
          <span className="font-mono text-label-sm text-port tabular-nums">{badge}</span>
        ) : null}
      </button>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={`${ui.tasks.closeTab}: ${label}`}
          title={ui.tasks.closeTab}
          className="mr-1 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" strokeWidth={1.75} />
        </button>
      ) : null}
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
