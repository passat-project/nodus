import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import type { SavedView } from '@nodus/contracts';

import { CardHeaderActionsPortal } from '../../../app/shell/card-header-actions.js';
import { useProjectConversation } from '../../../shared/chat/chat-queries.js';
import { ChatSidePanel, ChatPanelToggle } from '../../../shared/chat/chat-side-panel.js';
import {
  useDeleteSavedView,
  useProjectSavedViews,
} from '../../../shared/views/list-ext/saved-views-api.js';
import { CardLayoutButton } from '../../../shared/ui/entity-card/card-layout-button.js';
import { CardTabAreas } from '../../../shared/ui/entity-card/card-tab-areas.js';
import type { CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { PANEL_HIDDEN_HINT } from '../../../shared/ui/entity-card/card-width-hint.js';
import {
  mergeAllGroups,
  splitActiveTab,
} from '../../../shared/ui/entity-card/card-tabs-actions.js';
import { useCardTabs } from '../../../shared/ui/entity-card/use-card-tabs.js';
import { solveCardWidths } from '../../../shared/ui/entity-card/card-tabs-width.js';
import { useElementWidth } from '../../../shared/ui/use-element-width.js';
import { useProjectDetail } from '../api/projects-api.js';
import {
  PROJECT_DEFAULT_GROUPS,
  PROJECT_TAB_IDS,
  isProjectViewTabId,
  savedViewIdOfTab,
  type ProjectTabId,
} from '../lib/project-tabs.js';
import { ProjectAboutPanel } from './project-about-panel.js';
import { ProjectAddListTabDialog } from './project-add-list-tab-dialog.js';
import { ProjectHeaderActions } from './project-action-bar.js';
import { ProjectCardSkeleton } from './project-card-skeleton.js';
import { ProjectChannelTab } from './project-channel-tab.js';
import { ProjectHistoryTab } from './project-history-tab.js';
import { ProjectMembersTab } from './project-members-tab.js';
import { PROJECT_TAB_DEFS, ProjectTabsTrailing, projectViewTabDefs } from './project-tab-strip.js';
import { ProjectTasksTab } from './project-tasks-tab.js';
import { ProjectViewTab } from './project-view-tab.js';
import { StructureTab } from '../structure/components/structure-tab.js';
import { isProjectParticipant } from './project-chat.js';

/** Системные вкладки + динамические вкладки-списки (#435): сохранённые виды —
 *  сразу после «Задач» (порядок сервера: общие → списки типов → личные). */
function stableTabsOf(viewTabs: readonly SavedView[]): string[] {
  const views = projectViewTabDefs(viewTabs).map((tab) => tab.id);
  const at = PROJECT_TAB_IDS.indexOf('tasks') + 1;
  return [...PROJECT_TAB_IDS.slice(0, at), ...views, ...PROJECT_TAB_IDS.slice(at)];
}

/**
 * Карточка проекта (#52, ADR-0009; раскладка — вердикт владельца 10.11.2026,
 * #735/#746): вся карточка — полотно областей вкладок. Статичной левой
 * панели «О проекте» и нижнего бара больше нет: «О проекте» — обычная
 * вкладка после «Задач»; кнопки правки/статусов — в шапке карточки
 * (`ProjectHeaderActions`), кнопка раскладки — `Columns2/Combine`.
 * Области (1–2), порядок, DnD и ширины — общий движок `CardTabAreas`;
 * «Структура» — системный первый дефолт, личный порядок перекрывает.
 * Вкладки монтируются при первом показе и живут скрытыми (`inert`):
 * прокрутка, фильтры и черновик чата не теряются.
 * #435: вкладки-списки — динамические (GET /views?projectId=, «+» → «Список…»),
 * ленивый рендер `panel()` как у системных.
 */
export function ProjectCard({ projectId }: { projectId: string }) {
  const { data: project, isLoading } = useProjectDetail(projectId);
  const participant = project ? isProjectParticipant(project) : false;
  const { data: conversation } = useProjectConversation(projectId, participant);
  const savedViews = useProjectSavedViews(projectId);
  const deleteView = useDeleteSavedView();
  const [addListOpen, setAddListOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const rowWidth = useElementWidth(rowRef);
  const viewTabs = useMemo(() => savedViews.data ?? [], [savedViews.data]);
  const stableTabs = useMemo(() => stableTabsOf(viewTabs), [viewTabs]);
  const cardTabs = useCardTabs({
    kind: 'project',
    stableTabs,
    defaultActive: 'structure',
    defaultGroups: PROJECT_DEFAULT_GROUPS,
  });
  const { state } = cardTabs;
  const visible = new Set(cardTabs.visibleTabs);
  const viewsById = useMemo(() => new Map(viewTabs.map((view) => [view.id, view])), [viewTabs]);
  const tabDefs: CardTabDef[] = [
    ...PROJECT_TAB_DEFS.filter((tab) => visible.has(tab.id)).map((tab) =>
      tab.id === 'channel' && conversation?.unreadCount
        ? { ...tab, badge: conversation.unreadCount }
        : tab,
    ),
    ...projectViewTabDefs(viewTabs).filter((tab) => visible.has(tab.id)),
  ];

  const channelActive = state.groups.some((group) => group.active === 'channel');
  const panelRequested = cardTabs.panelOpen && channelActive && Boolean(conversation);
  const solved = useMemo(
    () =>
      solveCardWidths({
        rowWidth,
        groups: state.groups.map((group, index) => ({
          id: group.id,
          isChat: group.tabs.includes('channel'),
          prefW: cardTabs.widths.groups?.[index],
        })),
        panelOpen: panelRequested,
        panelW: 300,
      }),
    [cardTabs.widths.groups, panelRequested, rowWidth, state.groups],
  );

  if (isLoading || !project) {
    return <ProjectCardSkeleton />;
  }

  const conversationId = conversation?.id ?? null;

  const panel = (tabId: string): ReactNode => {
    if (isProjectViewTabId(tabId)) {
      const view = viewsById.get(savedViewIdOfTab(tabId) ?? '');
      return view ? <ProjectViewTab projectId={project.id} view={view} /> : null;
    }
    switch (tabId as ProjectTabId) {
      case 'structure':
        return (
          <StructureTab
            projectId={project.id}
            canManage={project.access.canManage}
            readOnly={project.status === 'archived'}
          />
        );
      case 'tasks':
        return <ProjectTasksTab projectId={project.id} />;
      case 'about':
        return <ProjectAboutPanel project={project} />;
      case 'channel':
        return <ProjectChannelTab project={project} conversationId={conversationId} />;
      case 'members':
        return <ProjectMembersTab project={project} />;
      case 'history':
        return <ProjectHistoryTab projectId={project.id} />;
      default:
        return null;
    }
  };

  return (
    <div ref={rowRef} className="flex h-full min-w-0">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <CardTabAreas
          label={ui.projects.tabsLabel}
          tabs={tabDefs}
          state={state}
          onStateChange={cardTabs.setState}
          onSplitTab={cardTabs.splitIntoTwo}
          renderPanel={panel}
          groupW={solved.groupW}
          collapsedGroupId={solved.collapsedGroupId}
          onGroupWidthsChange={cardTabs.setGroupWidths}
          groupMin={(group) =>
            group.tabs.includes('channel') ? (solved.panelRendered ? 280 : 420) : 280
          }
          onHideTab={cardTabs.toggleHidden}
          canHideTab={() => true}
          trailing={(group) =>
            group.id === state.groups[0]?.id ? (
              <ProjectTabsTrailing
                visible={cardTabs.visibleTabs}
                viewTabs={viewTabs}
                onToggle={cardTabs.toggleHidden}
                onAddList={() => setAddListOpen(true)}
                onDeleteViewTab={(viewId) => deleteView.mutate(viewId)}
              />
            ) : null
          }
          actions={(group, active) =>
            active?.id === 'channel' && conversationId ? (
              <ChatPanelToggle
                open={cardTabs.panelOpen}
                onToggle={() => cardTabs.setPanelOpen(!cardTabs.panelOpen)}
              />
            ) : null
          }
          hintText={panelRequested && !solved.panelRendered ? PANEL_HIDDEN_HINT : undefined}
          className="bg-card"
        />
      </div>

      {conversation && solved.panelRendered ? (
        <ChatSidePanel
          conversationId={conversation.id}
          conversation={conversation}
          open
          onClose={() => cardTabs.setPanelOpen(false)}
          title={ui.chat.aboutProject}
          headerClass="h-10"
          widthPx={solved.panelW}
        />
      ) : null}

      {addListOpen ? (
        <ProjectAddListTabDialog
          projectId={project.id}
          canManage={project.access.canManage}
          open
          onOpenChange={setAddListOpen}
          onSaved={() => void savedViews.refetch()}
        />
      ) : null}

      <CardHeaderActionsPortal>
        <ProjectHeaderActions
          project={project}
          layout={
            <CardLayoutButton
              groupCount={state.groups.length}
              onSplit={() =>
                cardTabs.splitIntoTwo(
                  splitActiveTab(state),
                  solved.groupW.reduce((sum, width) => sum + width, 0),
                )
              }
              onMerge={() => cardTabs.setState(mergeAllGroups(state))}
            />
          }
        />
      </CardHeaderActionsPortal>
    </div>
  );
}
