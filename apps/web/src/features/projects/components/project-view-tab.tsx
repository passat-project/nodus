/* eslint-disable nodus-internal/max-lines-warn -- вкладка-список проекта #435: три таблицы сущностей (задачи/письма/папки) одной рамкой — общий тулбар и применение вида, разрезание дублировало бы его */
import { useEffect, useMemo, useRef } from 'react';
import type {
  FolderListItem,
  LetterListItem,
  ListViewColumn,
  SavedView,
  TaskListItem,
  ViewSort,
} from '@nodus/contracts';
import { listsStrings } from '@nodus/contracts';
import { toast } from 'sonner';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@nodus/ui/components/button';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { letterRows, useLettersInfinite } from '../../../shared/api/letters-list.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import {
  customFieldValuesOf,
  useCustomFieldDefinitions,
} from '../../../shared/custom-fields/queries.js';
import { useCustomFieldFilterDefs } from '../../../shared/custom-fields/filter-defs.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { FilterPanelExtSections } from '../../../shared/views/filter-panel-ext.js';
import { useFolderTableFields } from '../../../shared/views/folder-table-fields.js';
import type {
  ActiveListFilter,
  FilterFieldDef,
  FilterState,
} from '../../../shared/views/list-filters.js';
import {
  folderRowValue,
  letterRowValue,
  taskRowValue,
} from '../../../shared/views/list-ext/list-field-values.js';
import {
  listFieldOfColumn,
  type ListExtParams,
} from '../../../shared/views/list-ext/list-ext-query.js';
import {
  sanitizeSavedViewExt,
  splitAttributeFilter,
} from '../../../shared/views/list-ext/list-ext-predicates.js';
import { predicatesToFilterState } from '../../../shared/views/list-ext/predicates-to-filter-state.js';
import {
  groupFieldOptions,
  numericFieldOptions,
} from '../../../shared/views/list-ext/list-field-options.js';
import { useListExt } from '../../../shared/views/list-ext/use-list-ext.js';
import { useListExportAction } from '../../../shared/views/list-ext/use-list-export-action.js';
import {
  useDeleteSavedView,
  useUpdateSavedView,
} from '../../../shared/views/list-ext/saved-views-api.js';
import { useGroupKeyLabeler } from '../../../shared/views/list-ext/use-list-lookups.js';
import { useLetterTableFields } from '../../../shared/views/letter-table-fields.js';
import { useLetterFilterDefs } from '../../../shared/views/letter-filter-fields.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import { taskBuiltinPresets, useTaskFilterDefs } from '../../../shared/views/task-filter-fields.js';
import { useTaskTableFields } from '../../../shared/views/task-table-fields.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useViewStore } from '../../../shared/views/view-store.js';
import { useProjectTaskPages } from '../api/projects-api.js';
import { useProjectFolderPages } from '../api/project-folders-api.js';
import { useFilterDefsOfEntity } from '../lib/view-tab-filter-defs.js';

/**
 * Вкладка-список карточки проекта (#435): сохранённая настройка рамки проекта
 * (общая проектная / личная / список типа по умолчанию) в виде строки
 * инструментов + канонической таблицы. Рамка проекта НЕ снимается: запрос
 * всегда идёт с projectId (условий projectId в панели нет), базовые предикаты
 * вида (например type_is «переработки») остаются поверх панельных правок —
 * панель только ДОБАВЛЯЕТ условия. Все три сущности — целиком сервер:
 * ext-конвейер с рамкой projectId держит строки, группы и итоги по всей
 * выборке (у писем — `?projectId=` в ext-списке).
 */
export function ProjectViewTab({ projectId, view }: { projectId: string; view: SavedView }) {
  const viewKey = `projects.view.${view.id}`;
  const { data: definitions } = useCustomFieldDefinitions(
    view.entity === 'folder' ? 'node' : view.entity,
  );
  const definitionList = useMemo(() => definitions ?? [], [definitions]);
  const saved = useMemo(() => sanitizeSavedViewExt(view, definitionList), [view, definitionList]);
  const toolbar = useListToolbar(viewKey, view.entity === 'task' ? taskBuiltinPresets : []);
  const ext = useListExt();
  const search = useDebouncedValue(toolbar.query.trim(), 250);

  // Применение сохранённой настройки — на монтирование вкладки и приход
  // реестра атрибутов (до него предикаты cf.* не собрать); правки панели
  // живут в сессии, refetch вида их не сбрасывает (ключ — состав реестра).
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const applyKey = `${view.id}|${definitionList.map((d) => d.id).join(',')}`;
  const fields = useFieldsOf(view.entity);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  useEffect(() => {
    toolbar.setFilters(predicatesToFilterState(savedRef.current.filter));
    ext.applyViewExt(savedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- применение вида
  }, [applyKey]);

  // Колонки вида — стартовый состав (правки — шестерёнкой, в сессии).
  useEffect(() => {
    const current = savedRef.current;
    const visible = new Set<string>(current.columns.map((column) => column.field));
    const byId = new Map(fieldsRef.current.map((f) => [f.id, f] as const));
    const ordered = [
      ...current.columns.flatMap((column: ListViewColumn) => byId.get(column.field) ?? []),
      ...fieldsRef.current.filter((f) => !visible.has(f.id)),
    ];
    if (ordered.length > 0) {
      useViewStore.getState().applyOrder(
        viewKey,
        ordered.map((f) => ({ id: f.id, visible: visible.has(f.id) })),
      );
    }
  }, [applyKey, viewKey]);

  const defs = useFilterDefsOfEntity(view.entity);
  const split = useMemo(
    () => splitAttributeFilter(toolbar.filters, definitionList),
    [toolbar.filters, definitionList],
  );
  // База вида (type_is и др., непереводимые панелью) + панельные предикаты
  // (потолок конъюнкции — 10, как у выборки #635).
  const filterPredicates = useMemo(
    () => [...saved.filter, ...split.predicates].slice(0, 10),
    [saved.filter, split.predicates],
  );
  const clientDefs = useMemo(
    () => defs.filter((def) => !split.serverFieldIds.has(def.id)),
    [defs, split.serverFieldIds],
  );

  const extParams = useMemo<ListExtParams>(
    () => ({ ...ext.params, filter: filterPredicates }),
    [ext.params, filterPredicates],
  );

  const groupFields = useMemo(
    () => groupFieldOptions(view.entity, definitionList),
    [view.entity, definitionList],
  );
  const numericFields = useMemo(
    () => numericFieldOptions(view.entity, definitionList),
    [view.entity, definitionList],
  );
  const exportCsv = useListExportAction();
  // Удаление списка — в его же панели (в меню «+» только видимость вкладок):
  // настройка живёт там, где настраивается.
  const deleteView = useDeleteSavedView();
  // Правка настроек созданного списка: текущее состояние панели (условия
  // базовые+панельные, сортировка, группировка, итоги) записывается в вид —
  // личную правит владелец, общую руководство (права решает сервер).
  const updateView = useUpdateSavedView();
  const saveChanges = () =>
    updateView.mutate(
      {
        id: view.id,
        body: {
          filter: filterPredicates,
          sort: ext.sort,
          // null — снять группировку: пропуск ключа означал бы «не трогать»,
          // и снятая группировка молча возвращалась при повторном открытии.
          group: ext.group ?? null,
          totals: ext.totals,
        },
      },
      {
        onSuccess: () => toast.success(listsStrings.tabs.changesSaved, { description: view.name }),
        onError: () => toast.error(listsStrings.tabs.saveChangesError),
      },
    );

  const visibleColumns = useMemo(
    () =>
      fields.flatMap((field) => {
        const listField = listFieldOfColumn(field.id, view.entity);
        return listField === null ? [] : [{ field: listField as ListViewColumn['field'] }];
      }),
    [fields, view.entity],
  );

  const serverSort: ViewSort | null = ext.sort[0]
    ? { field: ext.sort[0].field, dir: ext.sort[0].dir }
    : null;

  return (
    <div className="flex h-full flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={defs as FilterFieldDef<never>[]}
          builtinPresets={view.entity === 'task' ? taskBuiltinPresets : []}
          ext={{
            sections: (
              <FilterPanelExtSections
                state={ext}
                groupFields={groupFields}
                numericFields={numericFields}
              />
            ),
            onExportCsv: () =>
              void exportCsv({
                entity: view.entity,
                scope: { kind: 'project', projectId },
                filter: filterPredicates,
                sort: ext.sort,
                columns: visibleColumns,
              }),
            removedFieldIds: [...split.removedFieldIds],
            onReset: () => ext.reset(),
          }}
          right={
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={listsStrings.tabs.saveChanges}
                title={listsStrings.tabs.saveChanges}
                disabled={updateView.isPending}
                onClick={saveChanges}
                className="text-muted-foreground hover:text-foreground"
              >
                <Save className="size-4" strokeWidth={1.75} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={listsStrings.tabs.deleteTab}
                title={listsStrings.tabs.deleteTab}
                disabled={deleteView.isPending}
                onClick={() => deleteView.mutate(view.id)}
                className="text-muted-foreground hover:text-danger"
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
              </Button>
              <ViewSettings viewKey={viewKey} defs={fields} />
            </>
          }
        />
      </CardTabToolbar>
      <div className="min-h-0 flex-1">
        {view.entity === 'task' ? (
          <ProjectViewTasksTable
            projectId={projectId}
            search={search}
            extParams={extParams}
            viewKey={viewKey}
            serverSort={serverSort}
            ext={ext}
            clientDefs={clientDefs}
            filterState={toolbar.filters}
          />
        ) : view.entity === 'letter' ? (
          <ProjectViewLettersTable
            projectId={projectId}
            search={search}
            extParams={extParams}
            viewKey={viewKey}
            serverSort={serverSort}
            ext={ext}
            clientDefs={clientDefs}
            filterState={toolbar.filters}
          />
        ) : (
          <ProjectViewFoldersTable
            projectId={projectId}
            extParams={extParams}
            viewKey={viewKey}
            serverSort={serverSort}
            ext={ext}
            clientDefs={clientDefs}
            filterState={toolbar.filters}
          />
        )}
      </div>
    </div>
  );
}

/** Общие пропсы таблиц вкладки. */
interface ViewTableProps {
  projectId: string;
  search?: string;
  extParams: ListExtParams;
  viewKey: string;
  serverSort: ViewSort | null;
  ext: ReturnType<typeof useListExt>;
  /** Поля фильтра, не переведённые в предикаты (клиентский остаток). */
  clientDefs: readonly { id: string }[];
  filterState: FilterState;
}

function ProjectViewTasksTable({
  projectId,
  search,
  extParams,
  viewKey,
  serverSort,
  ext,
  clientDefs,
  filterState,
}: ViewTableProps) {
  const query = useProjectTaskPages(projectId, search, extParams);
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const defs = useTaskFilterDefs({ projectVisible: false });
  const filter = useMemo<ActiveListFilter<TaskListItem>>(
    () => ({
      defs: defs.filter((d) => clientDefs.some((c) => c.id === d.id)),
      state: filterState,
      query: '',
    }),
    [defs, clientDefs, filterState],
  );
  const rows = useFilteredList(items, filter);
  const openCard = useOpenCard();
  const fields = useTaskTableFields({ projectVisible: false });
  const { data: definitions } = useCustomFieldDefinitions('task');
  const labeler = useGroupKeyLabeler('task', definitions);
  return (
    <DataTable
      viewKey={viewKey}
      selectable={false}
      defs={fields}
      rows={rows}
      rowKey={(task) => task.id}
      isLoading={query.isLoading}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      onOpenRow={(task, rowEl) =>
        openCard({ kind: 'task', id: task.id }, rowEl.getBoundingClientRect())
      }
      ext={{
        serverSort,
        onServerSortCycle: (fieldId) =>
          ext.cycleColumnSort(fieldId, (id) => listFieldOfColumn(id, 'task')),
        isServerSortable: (field: { id: string }) => listFieldOfColumn(field.id, 'task') !== null,
        groups: extParams.group
          ? {
              buckets: query.data?.pages[0]?.groups ?? [],
              keyOf: (task) => taskRowValue(task, extParams.group!.field),
              labelOf: (key) => labeler(extParams.group!.field, key),
            }
          : undefined,
        totals:
          extParams.totals.length > 0
            ? { values: query.data?.pages[0]?.totals ?? [], defs: extParams.totals }
            : undefined,
      }}
    />
  );
}

function ProjectViewLettersTable({
  projectId,
  search,
  extParams,
  viewKey,
  serverSort,
  ext,
  clientDefs,
  filterState,
}: ViewTableProps) {
  // Рамка проекта (#435): сервер — `?projectId=` в `GET /letters` держит
  // строки и группы/итоги по всей выборке проекта, запросом не снимается.
  const query = useLettersInfinite(
    null,
    { projectId, search: search || undefined },
    { ext: extParams },
  );
  const serverRows = useMemo(() => letterRows(query.data), [query.data]);
  const defs = useLetterFilterDefs(serverRows, {});
  const filter = useMemo<ActiveListFilter<LetterListItem>>(
    () => ({
      defs: defs.filter((d) => clientDefs.some((c) => c.id === d.id)),
      state: filterState,
      query: '',
    }),
    [defs, clientDefs, filterState],
  );
  const rows = useFilteredList(serverRows, filter);
  const openCard = useOpenCard();
  const fields = useLetterTableFields({});
  const { data: definitions } = useCustomFieldDefinitions('letter');
  const labeler = useGroupKeyLabeler('letter', definitions);
  return (
    <DataTable
      viewKey={viewKey}
      selectable={false}
      defs={fields}
      rows={rows}
      rowKey={(letter) => letter.id}
      isLoading={query.isLoading}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      onOpenRow={(letter, rowEl) =>
        openCard({ kind: 'letter', id: letter.id }, rowEl.getBoundingClientRect())
      }
      ext={{
        serverSort,
        onServerSortCycle: (fieldId) =>
          ext.cycleColumnSort(fieldId, (id) => listFieldOfColumn(id, 'letter')),
        isServerSortable: (field: { id: string }) => listFieldOfColumn(field.id, 'letter') !== null,
        groups: extParams.group
          ? {
              buckets: query.data?.pages[0]?.groups ?? [],
              keyOf: (letter) => letterRowValue(letter, extParams.group!.field),
              labelOf: (key) => labeler(extParams.group!.field, key),
            }
          : undefined,
      }}
    />
  );
}

function ProjectViewFoldersTable({
  projectId,
  extParams,
  viewKey,
  serverSort,
  ext,
  clientDefs,
  filterState,
}: ViewTableProps) {
  const query = useProjectFolderPages(projectId, extParams);
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const defs = useCustomFieldFilterDefs('node', customFieldValuesOf);
  const filter = useMemo<ActiveListFilter<FolderListItem>>(
    () => ({
      defs: defs.filter((d) => clientDefs.some((c) => c.id === d.id)),
      state: filterState,
      query: '',
    }),
    [defs, clientDefs, filterState],
  );
  const rows = useFilteredList(items, filter);
  const fields = useFolderTableFields();
  const { data: definitions } = useCustomFieldDefinitions('node');
  const labeler = useGroupKeyLabeler('folder', definitions);
  // Папка без карточки-слайдера: свойства живут в дереве структуры — клик по
  // строке вкладки-списка ничего не открывает (список читает папки).
  const noopOpen = () => undefined;
  return (
    <DataTable
      viewKey={viewKey}
      selectable={false}
      defs={fields}
      rows={rows}
      rowKey={(folder) => folder.id}
      isLoading={query.isLoading}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      onOpenRow={noopOpen}
      label={listsStrings.listEntityLabels.folder}
      ext={{
        serverSort,
        onServerSortCycle: (fieldId) =>
          ext.cycleColumnSort(fieldId, (id) => listFieldOfColumn(id, 'folder')),
        isServerSortable: (field: { id: string }) => listFieldOfColumn(field.id, 'folder') !== null,
        groups: extParams.group
          ? {
              buckets: query.data?.pages[0]?.groups ?? [],
              keyOf: (folder) => folderRowValue(folder, extParams.group!.field),
              labelOf: (key) => labeler(extParams.group!.field, key),
            }
          : undefined,
        totals:
          extParams.totals.length > 0
            ? { values: query.data?.pages[0]?.totals ?? [], defs: extParams.totals }
            : undefined,
      }}
    />
  );
}

/** Реестры колонок по сущности вкладки. */
function useFieldsOf(entity: 'task' | 'letter' | 'folder') {
  const taskFields = useTaskTableFields({ projectVisible: false });
  const letterFields = useLetterTableFields({});
  const folderFields = useFolderTableFields();
  return entity === 'task' ? taskFields : entity === 'letter' ? letterFields : folderFields;
}
