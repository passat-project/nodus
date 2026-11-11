import { FolderKanban, ListTodo, MessageSquare } from 'lucide-react';
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import type { ProjectListItem, TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { ChatPanelToggle } from '../../../shared/chat/chat-side-panel.js';
import { CardTabStrip, type CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { EmployeeProjectsTab, EmployeeTasksTab } from './employee-journal-tabs.js';

/** Раздел ПРАВОЙ зоны карточки сотрудника: профиль — не вкладка, он всегда
 *  слева (вердикт владельца 11.11.2026). */
export type EmployeeWorkTab = 'chat' | 'tasks' | 'projects';

const TAB_IDS: readonly EmployeeWorkTab[] = ['chat', 'tasks', 'projects'];

/**
 * Правая рабочая зона карточки сотрудника (#750, вердикт 11.11.2026): общая
 * полоса вкладок карточек (`CardTabStrip`) — «Чат» (своя карточка —
 * «Избранное»), «Задачи», «Проекты»; меню/тоггл панели беседы — в правом
 * слоте. Содержимое вкладки монтируется при ПЕРВОМ показе и живёт скрытым
 * (`invisible` + `inert`), как в карточке задачи: скролл, фильтры журналов и
 * черновик чата не сбрасываются. Тоггл панели — только у чата, ушедшая
 * панель не сбрасывает своё состояние (решает хост).
 */
export function EmployeeCardWorkTabs({
  active,
  visited,
  onActivate,
  isOwnCard,
  chat,
  tasks,
  tasksLoading,
  onCreateTask,
  projects,
  projectsLoading,
  panelOpen,
  onPanelToggle,
}: {
  active: EmployeeWorkTab;
  /** Вкладки, которые уже показывались: после первого показа не размонтируются. */
  visited: readonly EmployeeWorkTab[];
  onActivate: (tab: EmployeeWorkTab) => void;
  /** Своя карточка: личный диалог с собой — «Избранное», не «Чат». */
  isOwnCard: boolean;
  /** Лента личного диалога (данные/ошибки грузит карточка). */
  chat: ReactNode;
  tasks: TaskListItem[];
  tasksLoading: boolean;
  onCreateTask: () => void;
  projects: ProjectListItem[];
  projectsLoading: boolean;
  /** Панель беседы открыта (её видимость решает хост по активной вкладке). */
  panelOpen: boolean;
  onPanelToggle: () => void;
}) {
  const baseId = useId();
  const domId = (tab: EmployeeWorkTab) => `${baseId}-${tab}`;

  const strip: CardTabDef[] = [
    {
      id: 'chat',
      label: isOwnCard ? ui.chat.notes : ui.employees.tabChat,
      icon: <MessageSquare className="size-3.5 shrink-0" />,
    },
    {
      id: 'tasks',
      label: ui.employees.tabTasks,
      icon: <ListTodo className="size-3.5 shrink-0" />,
      badge: tasks.length || undefined,
    },
    {
      id: 'projects',
      label: ui.employees.tabProjects,
      icon: <FolderKanban className="size-3.5 shrink-0" />,
      badge: projects.length || undefined,
    },
  ];

  function onStripKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = TAB_IDS.indexOf(active);
    const next =
      TAB_IDS[(index + (event.key === 'ArrowRight' ? 1 : -1) + TAB_IDS.length) % TAB_IDS.length];
    if (!next) return;
    event.preventDefault();
    onActivate(next);
    document.getElementById(`${domId(next)}-tab`)?.focus();
  }

  function panel(tab: EmployeeWorkTab) {
    if (tab === 'chat') return chat;
    if (tab === 'tasks') {
      return (
        <EmployeeTasksTab tasks={tasks} isLoading={tasksLoading} onCreateTask={onCreateTask} />
      );
    }
    return <EmployeeProjectsTab projects={projects} isLoading={projectsLoading} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <CardTabStrip
        label={ui.employees.tabsLabel}
        tabs={strip}
        active={active}
        onActivate={(id) => onActivate(id as EmployeeWorkTab)}
        idPrefix={baseId}
        onKeyDown={onStripKeyDown}
        badgeAlways
        actions={
          active === 'chat' ? <ChatPanelToggle open={panelOpen} onToggle={onPanelToggle} /> : null
        }
      />
      <div className="relative min-h-0 flex-1">
        {TAB_IDS.filter((tab) => visited.includes(tab)).map((tab) => {
          const isActive = tab === active;
          return (
            <div
              key={tab}
              role="tabpanel"
              id={`${domId(tab)}-panel`}
              aria-labelledby={`${domId(tab)}-tab`}
              inert={!isActive}
              className={cn('absolute inset-0', !isActive && 'invisible')}
            >
              {panel(tab)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
