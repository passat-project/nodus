import { useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useTaskStages } from '../../../shared/api/task-stages.js';
import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { makeTaskCardFields } from '../../../shared/views/task-card-fields.js';
import {
  taskBuiltinPresets,
  taskListPresets,
  taskSearchText,
  useTaskFilterDefs,
} from '../../../shared/views/task-filter-fields.js';
import { taskListFields } from '../lib/task-fields.js';
import { TaskKanban } from '../components/task-kanban.js';
import { TaskList } from '../components/task-list.js';
import { openTaskCreate } from '../../../shared/tasks/task-create-store.js';

/** Реестр блоков карточки канбана — module-константа (стабильная идентичность). */
const taskCardFields = makeTaskCardFields();

/** Задачи: виды «Мой план» (канбан) и «Список» — переключаются в топбаре.
 *  Шапка — ОДНА строка (вердикт владельца: пустого места нет): заголовок,
 *  строка инструментов (поиск с панелью фильтра из строки — модель Битрикс24,
 *  пресеты со «скрепкой»), счётчик «Просрочено» (клик — фильтр просроченных,
 *  модель Битрикс24) и шестерёнка активного вида. Память фильтров — своя на
 *  вид (viewKey); ширина колонок — ручкой в хедере таблицы. */
export function TasksPage() {
  const search = useSearch({ strict: false }) as { view?: string };
  const view = search.view === 'list' ? 'list' : 'kanban';
  const { data: stages } = useTaskStages();
  const overdueTotal = stages?.reduce((sum, s) => sum + s.overdueCount, 0) ?? 0;

  return (
    <div className="relative flex h-full flex-col">
      {/* key по виду: у каждого представления — своя память фильтров (viewKey) */}
      <TasksSection key={view} view={view} overdueTotal={overdueTotal} />
    </div>
  );
}

function TasksSection({ view, overdueTotal }: { view: 'list' | 'kanban'; overdueTotal: number }) {
  const viewKey = view === 'list' ? 'tasks.list' : 'tasks.kanban';
  // «Ждут моего решения» — только в списке (#433): канбан «Мой план» — личная
  // доска, журналы проектов/сотрудника — чужие фиды, серверного среза там нет.
  const presets = view === 'list' ? taskListPresets : taskBuiltinPresets;
  const toolbar = useListToolbar(viewKey, presets);
  const defs = useTaskFilterDefs({
    projectVisible: projectsAvailable(),
    deciderVisible: view === 'list',
  });
  const filter = useMemo<ActiveListFilter<TaskListItem>>(
    () => ({ defs, state: toolbar.filters, query: toolbar.query, searchText: taskSearchText }),
    [defs, toolbar.filters, toolbar.query],
  );
  const overdueActive = toolbar.filters.overdue === 'yes';
  const deciderActive = toolbar.filters.role === 'decider';
  const [scope, setScope] = useListScope();

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="shrink-0 text-xl font-semibold text-balance text-foreground">
          {ui.tasks.title}
        </h1>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={defs}
          builtinPresets={presets}
          left={
            // Закон кнопки создания (вердикт 15.09.2026): label всегда
            // «Создать» (без уточнения — кнопка не раздувается), высота =
            // поисковой строке (h-8, size default).
            <Button onClick={() => openTaskCreate()}>
              <Plus data-icon="inline-start" />
              {ui.common.create}
            </Button>
          }
          right={
            <>
              {view === 'list' && !deciderActive ? (
                <ScopeSwitch scope={scope} onChange={setScope} />
              ) : null}
              {overdueTotal > 0 ? (
                <button
                  type="button"
                  onClick={() => toolbar.setFilter('overdue', overdueActive ? undefined : 'yes')}
                  aria-pressed={overdueActive}
                  title={ui.tasks.showOverdue}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-label-sm font-semibold tracking-wide uppercase transition-colors',
                    overdueActive
                      ? 'bg-danger/15 text-danger'
                      : 'text-danger/80 hover:bg-danger/10',
                  )}
                >
                  <span className="font-semibold tabular-nums">{overdueTotal}</span>
                  {ui.tasks.summaryOverdue}
                </button>
              ) : null}
              <ViewSettings
                viewKey={viewKey}
                defs={view === 'list' ? taskListFields : taskCardFields}
              />
            </>
          }
        />
      </div>
      <div className="relative min-h-0 flex-1">
        {view === 'list' ? (
          <TaskList filter={filter} scope={scope} onCreate={() => openTaskCreate()} />
        ) : (
          <TaskKanban filter={filter} onCreate={() => openTaskCreate()} />
        )}
      </div>
    </>
  );
}

const SCOPE_KEY = 'nodus-tasks-scope-v1';

/** «Мои / Все доступные» журнала (модель Битрикс24 «Все задачи» для
 *  руководителя): выбор помнится между сессиями. «Мой план» — всегда личный. */
function useListScope(): ['mine' | 'all', (s: 'mine' | 'all') => void] {
  const [scope, setScope] = useState<'mine' | 'all'>(() =>
    localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'mine',
  );
  return [
    scope,
    (next) => {
      localStorage.setItem(SCOPE_KEY, next);
      setScope(next);
    },
  ];
}

function ScopeSwitch({
  scope,
  onChange,
}: {
  scope: 'mine' | 'all';
  onChange: (s: 'mine' | 'all') => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ui.tasks.scopeHint}
      title={ui.tasks.scopeHint}
      className="flex h-8 shrink-0 items-center rounded-lg bg-muted/40 p-0.5"
    >
      {(['mine', 'all'] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={scope === s}
          onClick={() => onChange(s)}
          className={cn(
            'h-7 rounded-md px-2.5 text-[13px] transition-colors',
            scope === s
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {s === 'mine' ? ui.tasks.scopeMine : ui.tasks.scopeAll}
        </button>
      ))}
    </div>
  );
}
