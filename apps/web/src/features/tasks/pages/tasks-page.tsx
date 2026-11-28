/* eslint-disable nodus-internal/max-lines-warn -- журнал задач: шапка + ext-панель #435 (виды, CSV, атрибуты сервером) одной страницей, как прежде */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { ListViewColumn, SavedView, TaskListItem, ViewSort } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useTaskStages } from '../../../shared/api/task-stages.js';
import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { useTaskCardFields } from '../../../shared/views/task-card-fields.js';
import {
  taskBuiltinPresets,
  taskListPresets,
  taskSearchText,
  useTaskFilterDefs,
} from '../../../shared/views/task-filter-fields.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import {
  sanitizeSavedViewExt,
  splitAttributeFilter,
} from '../../../shared/views/list-ext/list-ext-predicates.js';
import { predicatesToFilterState } from '../../../shared/views/list-ext/predicates-to-filter-state.js';
import {
  listFieldOfColumn,
  type ListExtParams,
} from '../../../shared/views/list-ext/list-ext-query.js';
import {
  groupFieldOptions,
  numericFieldOptions,
} from '../../../shared/views/list-ext/list-field-options.js';
import { FilterPanelExtSections } from '../../../shared/views/filter-panel-ext.js';
import { useListExt } from '../../../shared/views/list-ext/use-list-ext.js';
import { useListExportAction } from '../../../shared/views/list-ext/use-list-export-action.js';
import {
  useCreateSavedView,
  useDeleteSavedView,
  useJournalSavedViews,
} from '../../../shared/views/list-ext/saved-views-api.js';
import { useTaskTableFields } from '../../../shared/views/task-table-fields.js';
import { useViewStore } from '../../../shared/views/view-store.js';
import { useTaskListFields as useTreeFields } from '../lib/task-fields.js';
import { TaskKanban } from '../components/task-kanban.js';
import { TaskList } from '../components/task-list.js';
import { TasksExtTable } from '../components/tasks-ext-table.js';
import { openTaskCreate } from '../../../shared/tasks/task-create-store.js';

/** Задачи: виды «Мой план» (канбан) и «Список» — переключаются в топбаре.
 *  Шапка — ОДНА строка (вердикт владельца: пустого места нет): заголовок,
 *  строка инструментов (поиск с панелью фильтра из строки — модель Битрикс24,
 *  пресеты со «скрепкой»), счётчик «Просрочено» (клик — фильтр просроченных,
 *  модель Битрикс24) и шестерёнка активного вида. Память фильтров — своя на
 *  вид (viewKey); ширина колонок — ручкой в хедере таблицы. #435: панель
 *  фильтра расширена — атрибуты фильтрует сервер, сортировка по любой
 *  колонке серверная, группировка и итоги (цифрами) по всей выборке, вид —
 *  «Сохранить как вид» (личный) в механике пресетов, «Выгрузить CSV». */
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
  const taskListFields = useTreeFields();
  // Реестр блоков карточки канбана — с атрибутами портала (#632): реестр
  // меняется вместе с определениями, поэтому хук, а не module-константа.
  const cardFields = useTaskCardFields();
  const ext = useListExt();
  const [activeViewId, setActiveViewId] = useState<string | undefined>(undefined);
  // «Ждут моего решения» — только в списке (#433): канбан «Мой план» — личная
  // доска, журналы проектов/сотрудника — чужие фиды, серверного среза там нет.
  const presets = view === 'list' ? taskListPresets : taskBuiltinPresets;
  const toolbar = useListToolbar(viewKey, presets);
  // Серверный поиск (#956): журнал и колонки пагинированы — клиентский
  // фильтр видел только загруженные строки. Debounce — 250 мс, как у писем.
  const search = useDebouncedValue(toolbar.query.trim(), 250);
  const defs = useTaskFilterDefs({
    projectVisible: projectsAvailable(),
    deciderVisible: view === 'list',
  });
  const { data: definitions } = useCustomFieldDefinitions('task');
  const definitionList = useMemo(() => definitions ?? [], [definitions]);
  // Атрибутные фильтры уходят на сервер (#435): панель пишет их в ту же
  // FilterState (чипы/пресеты прежние), запрос несёт предикаты.
  const split = useMemo(
    () => splitAttributeFilter(toolbar.filters, definitionList),
    [toolbar.filters, definitionList],
  );
  const clientDefs = useMemo(
    () => defs.filter((def) => !split.serverFieldIds.has(def.id)),
    [defs, split.serverFieldIds],
  );
  const filter = useMemo<ActiveListFilter<TaskListItem>>(
    // Запрос уже применил сервер: на клиенте — только не переведённые поля.
    () => ({
      defs: view === 'list' ? clientDefs : defs,
      state: toolbar.filters,
      query: '',
      searchText: taskSearchText,
    }),
    [view, clientDefs, defs, toolbar.filters],
  );
  const extParams = useMemo<ListExtParams>(
    () => ({ ...ext.params, filter: split.predicates }),
    [ext.params, split.predicates],
  );
  const overdueActive = toolbar.filters.overdue === 'yes';
  const deciderActive = toolbar.filters.role === 'decider';
  const [scope, setScope] = useListScope();

  // Сохранённые виды журнала (#435): личные, применение — как пресет (фильтры
  // в панель, сортировка/группировка/итоги/колонки — в свои механики).
  const savedViewsQuery = useJournalSavedViews(view === 'list' ? 'task' : undefined);
  const createView = useCreateSavedView();
  const deleteView = useDeleteSavedView();
  const exportCsv = useListExportAction();
  const flatFields = useTaskTableFields({ projectVisible: projectsAvailable() });

  const savedViews = useMemo(
    () =>
      (savedViewsQuery.data ?? []).map((viewEntry) =>
        sanitizeSavedViewExt(viewEntry, definitionList),
      ),
    [savedViewsQuery.data, definitionList],
  );

  const applySavedView = (saved: SavedView) => {
    toolbar.setFilters(predicatesToFilterState(saved.filter));
    ext.applyViewExt(saved);
    applyViewColumns(saved);
    setActiveViewId(saved.id);
  };

  /** Колонки вида → порядок/видимость view-store (id реестров совпадают). */
  const applyViewColumns = (saved: SavedView) => {
    const visible = new Set<string>(saved.columns.map((column: ListViewColumn) => column.field));
    const byId = new Map([...flatFields, ...taskListFields].map((f) => [f.id, f]));
    const ordered = [
      ...saved.columns.flatMap((column: ListViewColumn) => byId.get(column.field) ?? []),
      ...[...byId.values()].filter((f) => !visible.has(f.id)),
    ];
    useViewStore.getState().applyOrder(
      viewKey,
      ordered.map((f) => ({ id: f.id, visible: visible.has(f.id) })),
    );
  };

  const saveView = (name: string) => {
    createView.mutate(
      {
        name,
        entity: 'task',
        scope: { kind: 'journal' },
        level: 'personal',
        filter: split.predicates,
        sort: ext.sort,
        group: ext.group,
        totals: ext.totals,
        columns: visibleColumnsOf(flatFields),
      },
      {
        onSuccess: (saved) => {
          setActiveViewId(saved.id);
          toast.success(ui.lists.panel.viewSaved);
        },
        onError: () => toast.error(ui.lists.panel.saveViewError),
      },
    );
  };

  const groupFields = useMemo(() => groupFieldOptions('task', definitionList), [definitionList]);
  const numericFields = useMemo(
    () => numericFieldOptions('task', definitionList),
    [definitionList],
  );

  const grouped = view === 'list' && ext.group !== undefined;
  const serverSort: ViewSort | null =
    view === 'list' && ext.sort[0] ? { field: ext.sort[0].field, dir: ext.sort[0].dir } : null;

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
          ext={
            view === 'list'
              ? {
                  sections: (
                    <FilterPanelExtSections
                      state={ext}
                      groupFields={groupFields}
                      numericFields={numericFields}
                    />
                  ),
                  savedViews: {
                    views: savedViews,
                    activeViewId,
                    onApply: applySavedView,
                    onDelete: (saved) => {
                      deleteView.mutate(saved.id, {
                        onSuccess: () => toast.success(ui.lists.panel.viewDeleted),
                      });
                    },
                  },
                  onSaveView: saveView,
                  onExportCsv: () =>
                    void exportCsv({
                      entity: 'task',
                      scope: { kind: 'journal' },
                      filter: split.predicates,
                      sort: ext.sort,
                      columns: visibleColumnsOf(grouped ? flatFields : taskListFields),
                    }),
                  removedFieldIds: [...split.removedFieldIds],
                  onReset: () => {
                    ext.reset();
                    setActiveViewId(undefined);
                  },
                }
              : undefined
          }
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
                defs={grouped ? flatFields : view === 'list' ? taskListFields : cardFields}
              />
            </>
          }
        />
      </div>
      <div className="relative min-h-0 flex-1">
        {view === 'list' ? (
          grouped ? (
            <TasksExtTable
              scope={scope}
              search={search}
              extParams={extParams}
              ext={ext}
              filter={filter}
            />
          ) : (
            <TaskList
              filter={filter}
              scope={scope}
              search={search}
              onCreate={() => openTaskCreate()}
              extParams={extParams}
              serverSort={serverSort}
              onServerSortCycle={(fieldId) =>
                ext.cycleColumnSort(fieldId, (id) => listFieldOfColumn(id, 'task'))
              }
              isServerSortable={(fieldId) => listFieldOfColumn(fieldId, 'task') !== null}
            />
          )
        ) : (
          <TaskKanban filter={filter} search={search} onCreate={() => openTaskCreate()} />
        )}
      </div>
    </>
  );
}

/** Колонки выгрузки/вида: видимые поля реестра, которые сервер знает. */
function visibleColumnsOf(fields: readonly { id: string }[]): ListViewColumn[] {
  return fields.flatMap((field) => {
    const listField = listFieldOfColumn(field.id, 'task');
    return listField === null ? [] : [{ field: listField as ListViewColumn['field'] }];
  });
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
