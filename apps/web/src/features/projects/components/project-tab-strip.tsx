import {
  BookMarked,
  History,
  Info,
  ListTodo,
  ListTree,
  MessagesSquare,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

import type { SavedView } from '@nodus/contracts';
import type { CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { listsStrings } from '@nodus/contracts';
import {
  PROJECT_TAB_IDS,
  isProjectViewTabId,
  savedViewIdOfTab,
  type ProjectTabId,
} from '../lib/project-tabs.js';

const TAB_META: Record<ProjectTabId, { label: string; icon: LucideIcon }> = {
  structure: { label: ui.projects.tabStructure, icon: ListTree },
  tasks: { label: ui.projects.tabTasks, icon: ListTodo },
  about: { label: ui.projects.tabAbout, icon: Info },
  channel: { label: ui.projects.tabChannel, icon: MessagesSquare },
  members: { label: ui.projects.tabMembers, icon: Users },
  history: { label: ui.projects.tabHistory, icon: History },
};

/** Реестр вкладок проекта в системном порядке (#735): «О проекте» — обычная
 *  вкладка после «Задач». */
export const PROJECT_TAB_DEFS: CardTabDef[] = PROJECT_TAB_IDS.map((id) => {
  const Icon = TAB_META[id].icon;
  return {
    id,
    label: TAB_META[id].label,
    icon: <Icon className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />,
  };
});

/** Динамические вкладки-списки проекта (#435): сохранённые настройки рамки —
 *  строка полосы вкладок той же грамматики (иконка закладки), после «Задач». */
export function projectViewTabDefs(views: readonly SavedView[]): CardTabDef[] {
  return views.map((view) => ({
    id: `view:${view.id}`,
    label: view.name,
    icon: <BookMarked className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />,
  }));
}

/** «+» личного набора вкладок: скрытие/возврат системных вкладок, вкладки-
 *  списки (#435 — скрытие и удаление) и создание новой («Список…»). Последнюю
 *  видимую скрыть нельзя (рабочая зона не остаётся пустой). */
export function ProjectTabsTrailing({
  visible,
  viewTabs,
  onToggle,
  onAddList,
  onDeleteViewTab,
}: {
  visible: readonly string[];
  viewTabs: readonly SavedView[];
  onToggle: (id: string) => void;
  onAddList: () => void;
  onDeleteViewTab: (viewId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={ui.projects.tabsManage}
          title={ui.projects.tabsManage}
          className="text-muted-foreground hover:bg-accent"
        >
          <Plus className="size-4" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onSelect={onAddList}>{ui.lists.tabs.addList}</DropdownMenuItem>
        {viewTabs.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{listsStrings.panel.savedViews}</DropdownMenuLabel>
            <DropdownMenuGroup>
              {viewTabs.map((view) => {
                const tabId = `view:${view.id}`;
                const checked = visible.includes(tabId);
                return (
                  <div key={view.id} className="group relative">
                    <DropdownMenuCheckboxItem
                      checked={checked}
                      disabled={checked && visible.length <= 1}
                      onCheckedChange={() => onToggle(tabId)}
                      onSelect={(event) => event.preventDefault()}
                      className="pr-8"
                    >
                      <span className="min-w-0 truncate" title={view.name}>
                        {view.name}
                        <span className="ml-1.5 text-muted-foreground">
                          {listsStrings.listEntityLabels[view.entity]}
                        </span>
                      </span>
                    </DropdownMenuCheckboxItem>
                    <button
                      type="button"
                      aria-label={ui.lists.tabs.deleteTab}
                      title={ui.lists.tabs.deleteTab}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteViewTab(view.id);
                      }}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                );
              })}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {PROJECT_TAB_IDS.map((id) => {
          const checked = visible.includes(id);
          return (
            <DropdownMenuCheckboxItem
              key={id}
              checked={checked}
              disabled={checked && visible.length <= 1}
              onCheckedChange={() => onToggle(id)}
              onSelect={(event) => event.preventDefault()}
            >
              {TAB_META[id].label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { isProjectViewTabId, savedViewIdOfTab };
