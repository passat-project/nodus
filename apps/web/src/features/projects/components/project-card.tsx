import { useRef, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useProjectConversation } from '../../../shared/chat/chat-queries.js';
import { useChatSidePanel } from '../../../shared/chat/chat-side-panel.js';
import { useSplitWidth } from '../../../shared/ui/use-split-width.js';
import { uiPx } from '../../../shared/ui/ui-scale.js';
import { useProjectDetail } from '../api/projects-api.js';
import { primaryTab, type ProjectTabId } from '../lib/project-tabs.js';
import { ProjectAboutPanel } from './project-about-panel.js';
import { ProjectActionBar } from './project-action-bar.js';
import { ProjectCardSkeleton } from './project-card-skeleton.js';
import { ProjectChannelTab } from './project-channel-tab.js';
import { ProjectHistoryTab } from './project-history-tab.js';
import { ProjectMembersTab } from './project-members-tab.js';
import { ProjectTabStrip } from './project-tab-strip.js';
import { ProjectTasksTab } from './project-tasks-tab.js';
import { StructureTab } from '../structure/components/structure-tab.js';
import { isProjectParticipant } from './project-chat.js';

/** Полы зон карточки: панель «О проекте» и рабочая зона вкладок. */
const MIN_ABOUT_W = uiPx(320);
const MIN_WORK_W = uiPx(420);

/**
 * Карточка проекта (#52, ADR-0009; раскладка — вердикт владельца 07.11.2026):
 * СЛЕВА всегда панель «О проекте» (без вкладки — главная панель проекта:
 * идентичность, описание, паспорт, атрибуты) с нижним баром действий, как в
 * задачах и письмах; СПРАВА — рабочая зона с вкладками «Структура / Задачи /
 * Канал / Участники / История» и «+» (личный набор; первичная вкладка —
 * «Структура», вердикт владельца 04.11.2026; «Чат проекта» появится вместе с
 * пространством проекта, #456). Перегородка тянется с памятью — полоса
 * вкладок едет за границей левой панели. Вкладки монтируются при первом
 * показе и дальше живут скрытыми (`invisible` + `inert`): прокрутка, фильтры
 * и черновик чата не теряются при переключении.
 */
export function ProjectCard({ projectId }: { projectId: string }) {
  const { data: project, isLoading } = useProjectDetail(projectId);
  const participant = project ? isProjectParticipant(project) : false;
  const { data: conversation } = useProjectConversation(projectId, participant);
  const channelPanel = useChatSidePanel();
  // Дефолт вкладки (вердикт владельца 04.11.2026): всегда первая
  // «Структура»; карточка не ждёт загрузки дерева, чтобы выбрать вкладку.
  const primary = primaryTab();
  const [tab, setTab] = useState<ProjectTabId>('structure');
  const [visited, setVisited] = useState<ProjectTabId[]>(['structure']);
  const aboutRef = useRef<HTMLDivElement>(null);
  const split = useSplitWidth(aboutRef, {
    storeKey: 'nodus-project-card-split-v1',
    defaultRatio: 0.42,
    min: MIN_ABOUT_W,
    minOther: MIN_WORK_W,
  });

  function activate(next: ProjectTabId) {
    setTab(next);
    setVisited((prev) => (prev.includes(next) ? prev : [...prev, next]));
  }

  if (isLoading || !project) {
    return <ProjectCardSkeleton />;
  }

  const conversationId = conversation?.id ?? null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative flex min-h-0 flex-1">
        {/* ЛЕВАЯ панель — «О проекте» на всю высоту; скроллится контент,
            нижний бар h-16 замоноличен (его верхняя линия — одна горизонталь
            с барами рабочей зоны). border-r — структурная граница; ручка —
            оверлей поверх неё. */}
        <div
          ref={aboutRef}
          role="region"
          aria-label={ui.projects.tabAbout}
          className={cn(
            'relative flex min-h-0 min-w-0 flex-col border-r border-border @container',
            !split.dragging && 'transition-[width] duration-200 ease-out',
          )}
          style={{ ...split.style, flexShrink: 1 }}
        >
          <div className="content-fade min-h-0 flex-1 overflow-hidden">
            <ProjectAboutPanel project={project} />
          </div>
          <div className="flex h-16 shrink-0 items-center border-t border-border px-5">
            <ProjectActionBar project={project} />
          </div>
          <div
            onPointerDown={split.onDividerDown}
            role="separator"
            aria-orientation="vertical"
            aria-label={ui.common.resizePanel}
            title={ui.common.resizePanel}
            className="group absolute top-0 right-0 z-10 h-full w-3 translate-x-1/2 cursor-col-resize"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-port/60 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>

        {/* ПРАВАЯ рабочая зона: полоса вкладок начинается от границы левой
            панели и едет вместе с ней при перетаскивании перегородки. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ProjectTabStrip
            tab={tab}
            onTab={activate}
            primary={primary}
            unread={conversation?.unreadCount}
            channelPanel={
              tab === 'channel' && conversationId
                ? { open: channelPanel.open, onToggle: channelPanel.toggle }
                : null
            }
          />
          <div className="relative min-h-0 flex-1">
            {visited.includes('structure') ? (
              <TabPanel active={tab === 'structure'}>
                <StructureTab
                  projectId={project.id}
                  canManage={project.access.canManage}
                  readOnly={project.status === 'archived'}
                />
              </TabPanel>
            ) : null}
            {visited.includes('tasks') ? (
              <TabPanel active={tab === 'tasks'}>
                <ProjectTasksTab projectId={project.id} />
              </TabPanel>
            ) : null}
            {visited.includes('channel') ? (
              <TabPanel active={tab === 'channel'}>
                <ProjectChannelTab
                  project={project}
                  conversationId={conversationId}
                  panel={channelPanel}
                />
              </TabPanel>
            ) : null}
            {visited.includes('members') ? (
              <TabPanel active={tab === 'members'}>
                <ProjectMembersTab project={project} />
              </TabPanel>
            ) : null}
            {visited.includes('history') ? (
              <TabPanel active={tab === 'history'}>
                <ProjectHistoryTab projectId={project.id} />
              </TabPanel>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Панель вкладки: смонтирована при первом показе, скрыта без размонтирования
 *  (прокрутка и локальное состояние живут), `inert` убирает её из обхода.
 *  Скрытие — `hidden` (display:none), а не `invisible`: visibility-предок
 *  оставлял старую вкладку поверх новой на кадр переключения. */
function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" inert={!active} className={cn('absolute inset-0', !active && 'hidden')}>
      {children}
    </div>
  );
}
