import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { ProjectListItem, TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import {
  projectBuiltinPresets,
  projectSearchText,
  useProjectFilterDefs,
} from '../../../shared/views/project-filter-fields.js';
import { useProjectTableFields } from '../../../shared/views/project-table-fields.js';
import {
  taskBuiltinPresets,
  taskSearchText,
  useTaskFilterDefs,
} from '../../../shared/views/task-filter-fields.js';
import { useTaskTableFields } from '../../../shared/views/task-table-fields.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';

/**
 * Вкладки «Задачи»/«Проекты» карточки сотрудника — ПОЛНОЦЕННЫЕ журналы по
 * единому стандарту («модули не отличаются»): строка инструментов (локальный
 * поиск + фильтр с пресетами + шестерёнка полей) над канонической таблицей.
 * Фильтр «Ответственный» скрыт — список и так по сотруднику.
 */
export function EmployeeTasksTab({
  tasks,
  isLoading,
  onCreateTask,
}: {
  tasks: TaskListItem[];
  isLoading: boolean;
  /** «Создать» — экспресс-форма с исполнителем=сотрудник (вердикт 15.09.2026). */
  onCreateTask: () => void;
}) {
  const openCard = useOpenCard();
  const toolbar = useListToolbar('directory.tasks', taskBuiltinPresets);
  // Реестр колонок — хук: атрибуты портала (#632) приходят с сервера.
  const fields = useTaskTableFields();
  const defs = useTaskFilterDefs({
    projectVisible: projectsAvailable(),
    assigneeVisible: false,
  });
  const filter = useMemo<ActiveListFilter<TaskListItem>>(
    () => ({ defs, state: toolbar.filters, query: toolbar.query, searchText: taskSearchText }),
    [defs, toolbar.filters, toolbar.query],
  );
  const rows = useFilteredList(tasks, filter);

  return (
    <div className="flex h-full flex-col">
      {/* БЕЗ border-b (канон раунда 6 + вердикт владельца 12.09.2026): линия
          под тулбаром читалась «полоской под поиском» — сегмент справа от
          поля, сжимающегося после закрытия панели фильтра. Журналы и
          вкладки-списки карточек выглядят ОДИНАКОВО. */}
      <ListToolbar
        toolbar={toolbar}
        defs={defs}
        builtinPresets={taskBuiltinPresets}
        left={
          // Закон кнопки создания (вердикт 15.09.2026): слева от поиска,
          // label «Создать», h-8 — и во вкладках карточек тоже.
          <Button onClick={onCreateTask}>
            <Plus data-icon="inline-start" />
            {ui.common.create}
          </Button>
        }
        right={<ViewSettings viewKey="directory.tasks" defs={fields} />}
      />
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey="directory.tasks"
          defs={fields}
          rows={rows}
          rowKey={(task) => task.id}
          isLoading={isLoading}
          emptyTitle={ui.employees.noTasks}
          onOpenRow={(task, rowEl) =>
            openCard({ kind: 'task', id: task.id }, rowEl.getBoundingClientRect())
          }
        />
      </div>
    </div>
  );
}

export function EmployeeProjectsTab({
  projects,
  isLoading,
}: {
  projects: ProjectListItem[];
  isLoading: boolean;
}) {
  const openCard = useOpenCard();
  const toolbar = useListToolbar('directory.projects', projectBuiltinPresets);
  // Реестр колонок — хук: атрибуты портала (#632) приходят с сервера.
  const fields = useProjectTableFields();
  const defs = useProjectFilterDefs();
  const filter = useMemo<ActiveListFilter<ProjectListItem>>(
    () => ({ defs, state: toolbar.filters, query: toolbar.query, searchText: projectSearchText }),
    [defs, toolbar.filters, toolbar.query],
  );
  const rows = useFilteredList(projects, filter);

  return (
    <div className="flex h-full flex-col">
      {/* БЕЗ border-b — канон единой строки инструментов (см. задачи выше). */}
      <ListToolbar
        toolbar={toolbar}
        defs={defs}
        builtinPresets={projectBuiltinPresets}
        right={<ViewSettings viewKey="directory.projects" defs={fields} />}
      />
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey="directory.projects"
          defs={fields}
          rows={rows}
          rowKey={(project) => project.id}
          isLoading={isLoading}
          emptyTitle={ui.employees.noProjects}
          onOpenRow={(project, rowEl) =>
            openCard({ kind: 'project', id: project.id }, rowEl.getBoundingClientRect())
          }
        />
      </div>
    </div>
  );
}
