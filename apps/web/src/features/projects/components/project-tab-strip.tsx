import { History, Info, ListTodo, ListTree, MessagesSquare, Plus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

import type { CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { PROJECT_TAB_IDS, type ProjectTabId } from '../lib/project-tabs.js';

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

/** «+» личного набора вкладок: скрытие/возврат; последнюю видимую скрыть
 *  нельзя (рабочая зона не остаётся пустой). */
export function ProjectTabsTrailing({
  visible,
  onToggle,
}: {
  visible: readonly string[];
  onToggle: (id: ProjectTabId) => void;
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
      <DropdownMenuContent align="start" className="w-52">
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
