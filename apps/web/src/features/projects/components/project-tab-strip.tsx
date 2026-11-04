import { History, ListTodo, ListTree, MessagesSquare, Plus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

import { ChatPanelToggle } from '../../../shared/chat/chat-side-panel.js';
import { CardTabStrip, type CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { useProjectTabs, type ProjectTabId } from '../lib/project-tabs.js';

const TAB_DEFS: { id: ProjectTabId; label: string; icon: LucideIcon }[] = [
  { id: 'structure', label: ui.projects.tabStructure, icon: ListTree },
  { id: 'tasks', label: ui.projects.tabTasks, icon: ListTodo },
  { id: 'channel', label: ui.projects.tabChannel, icon: MessagesSquare },
  { id: 'members', label: ui.projects.tabMembers, icon: Users },
  { id: 'history', label: ui.projects.tabHistory, icon: History },
];

/**
 * Полоса вкладок рабочей зоны проекта на общей полосе карточек
 * (`CardTabStrip`): «Структура / Задачи / Канал / Участники / История» +
 * «+» (личный набор, память); первичная — «Структура» (вердикт 04.11.2026),
 * не скрывается. Тоггл панели «О канале» — в правом слоте полосы.
 */
export function ProjectTabStrip({
  tab,
  onTab,
  primary,
  unread,
  channelPanel,
}: {
  tab: ProjectTabId;
  onTab: (tab: ProjectTabId) => void;
  /** Первичная вкладка (нельзя скрыть). */
  primary: ProjectTabId;
  /** Непрочитанные канала — счётчик на вкладке. */
  unread?: number;
  /** Панель «О канале»: тоггл — НА ПОЛОСЕ ВКЛАДОК (как в письмах), второго
   *  бара под вкладками нет — вердикт владельца 07.11.2026. */
  channelPanel?: { open: boolean; onToggle: () => void } | null;
}) {
  const { toggle, visible } = useProjectTabs(primary);
  const tabs: CardTabDef[] = TAB_DEFS.filter((def) => visible.includes(def.id)).map((def) => ({
    id: def.id,
    label: def.label,
    icon: <def.icon className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />,
    badge: def.id === 'channel' ? unread : undefined,
  }));

  return (
    <CardTabStrip
      label={ui.projects.tabsLabel}
      tabs={tabs}
      active={tab}
      onActivate={(id) => onTab(id as ProjectTabId)}
      trailing={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={ui.projects.tabsManage}
              title={ui.projects.tabsManage}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {TAB_DEFS.map((def) => (
              <DropdownMenuCheckboxItem
                key={def.id}
                checked={visible.includes(def.id)}
                disabled={def.id === primary}
                onCheckedChange={() => toggle(def.id)}
                onSelect={(event) => event.preventDefault()}
              >
                {def.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
      actions={
        channelPanel ? (
          <ChatPanelToggle open={channelPanel.open} onToggle={channelPanel.onToggle} />
        ) : null
      }
    />
  );
}
