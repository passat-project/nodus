import { List, Plus, SquareKanban } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { openTaskCreate } from '../../../shared/tasks/task-create-store.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import {
  taskBuiltinPresets,
  taskSearchText,
  useTaskFilterDefs,
} from '../../../shared/views/task-filter-fields.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useTaskCardFields } from '../../../shared/views/task-card-fields.js';
import { useTaskTableFields } from '../../../shared/views/task-table-fields.js';
import { ProjectKanban } from './project-kanban.js';
import { ProjectTaskList } from './project-task-list.js';

type TasksView = 'list' | 'kanban';

const tasksViews: { id: TasksView; label: string; icon: typeof List }[] = [
  { id: 'list', label: ui.tasks.viewList, icon: List },
  { id: 'kanban', label: ui.tasks.viewKanban, icon: SquareKanban },
];

/**
 * Вкладка «Задачи» карточки проекта: строка инструментов (единый стандарт)
 * — переключатель вида Список/Канбан, локальный поиск по задачам проекта,
 * фильтр по атрибутам с пресетами, шестерёнка отображаемых полей активного
 * вида. Органы управления — в ЗОНЕ ЗАДАЧ, не в таб-баре карточки (вердикт
 * владельца 2026-09-11); поле «Проект» фильтра скрыто (контекст очевиден).
 */
export function ProjectTasksTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<TasksView>('list');
  const toolbar = useListToolbar('projects.tasks', taskBuiltinPresets);
  const defs = useTaskFilterDefs({ projectVisible: false });
  // Реестры видов с атрибутами портала (#632): шестерёнка показывает их
  // вместе с системными полями; «Проект» скрыт — контекст очевиден.
  const listFields = useTaskTableFields({ projectVisible: false });
  const cardFields = useTaskCardFields({ projectVisible: false });
  const filter = useMemo<ActiveListFilter<TaskListItem>>(
    () => ({ defs, state: toolbar.filters, query: toolbar.query, searchText: taskSearchText }),
    [defs, toolbar.filters, toolbar.query],
  );

  return (
    <div className="flex h-full flex-col">
      {/* БЕЗ border-b (канон раунда 6 + вердикт владельца 12.09.2026): линия
          под тулбаром читалась «полоской под поиском»; вкладки-списки
          карточек и журналы — одинаково без неё. */}
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={defs}
          builtinPresets={taskBuiltinPresets}
          left={
            <div className="flex items-center gap-2">
              {/* Закон кнопки создания (вердикт 15.09.2026): первичное действие
                  вкладки-списка — первый элемент строки инструментов, проект
                  подставлен в окно создания задачи. */}
              <Button type="button" onClick={() => openTaskCreate({ projectId })}>
                <Plus data-icon="inline-start" />
                {ui.common.create}
              </Button>
              <div className="flex items-center rounded-lg border border-border p-0.5">
                {tasksViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v.id)}
                    aria-pressed={view === v.id}
                    title={v.label}
                    aria-label={v.label}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md transition-colors',
                      view === v.id
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:text-foreground/80',
                    )}
                  >
                    <v.icon className="size-3.5" strokeWidth={1.75} />
                  </button>
                ))}
              </div>
            </div>
          }
          right={
            <ViewSettings
              viewKey={view === 'list' ? 'projects.tasks' : 'projects.kanban'}
              defs={view === 'list' ? listFields : cardFields}
            />
          }
        />
      </CardTabToolbar>
      <div className="min-h-0 flex-1">
        {view === 'list' ? (
          <ProjectTaskList projectId={projectId} filter={filter} />
        ) : (
          <ProjectKanban projectId={projectId} filter={filter} />
        )}
      </div>
    </div>
  );
}
