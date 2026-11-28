/* eslint-disable nodus-internal/max-lines-warn -- журнал писем: вкладка + ext-панель #435 (виды, CSV, атрибуты сервером) одним компонентом, как прежде */
import { FilePlus2, Inbox, MailCheck, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  LetterBox,
  LetterListItem,
  ListViewColumn,
  SavedView,
  ViewSort,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';
import { Button } from '@nodus/ui/components/button';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { letterRows, useLettersInfinite } from '../../../shared/api/letters-list.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import { DataTable } from '../../../shared/views/data-table.js';
import {
  letterBuiltinPresets,
  useLetterFilterDefs,
} from '../../../shared/views/letter-filter-fields.js';
import { useLetterTableFields } from '../../../shared/views/letter-table-fields.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { letterRowValue } from '../../../shared/views/list-ext/list-field-values.js';
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
import { FilterPanelExtSections } from '../../../shared/views/filter-panel-ext.js';
import { useListExt } from '../../../shared/views/list-ext/use-list-ext.js';
import { useListExportAction } from '../../../shared/views/list-ext/use-list-export-action.js';
import {
  useCreateSavedView,
  useDeleteSavedView,
  useJournalSavedViews,
} from '../../../shared/views/list-ext/saved-views-api.js';
import { useViewStore } from '../../../shared/views/view-store.js';
import { useGroupKeyLabeler } from '../../../shared/views/list-ext/use-list-lookups.js';
import { usePrefetchLetter } from '../api/letters-queries.js';
import { LettersEmpty, LettersLoadError } from './letters-empty.js';
import { LettersHeader } from './letters-header.js';
import { ManualLetterDialog } from './manual-letter-dialog.js';

const journal = {
  new: {
    label: ui.letters.tabs.new,
    icon: MailCheck,
    empty: ui.letters.list.newEmpty,
    hint: ui.letters.list.newEmptyHint,
  },
  incoming: {
    label: ui.letters.tabs.incoming,
    icon: Inbox,
    empty: ui.letters.list.incomingEmpty,
    hint: ui.letters.list.incomingEmptyHint,
  },
  outgoing: {
    label: ui.letters.tabs.outgoing,
    icon: Send,
    empty: ui.letters.list.outgoingEmpty,
    hint: ui.letters.list.outgoingEmptyHint,
  },
} as const;

const letterKey = (letter: LetterListItem) => letter.id;

/** Колонка журнала писем → поле списка сервера (id расходятся у корреспондента
 *  и адресата — термины контракта списков #435). */
const LETTER_COLUMN_ALIASES: Record<string, string> = {
  regNumber: 'regNumber',
  counterparty: 'correspondent',
  addressee: 'assignee',
  stage: 'stage',
  project: 'project',
};

function letterListFieldOfColumn(fieldId: string) {
  const aliased = LETTER_COLUMN_ALIASES[fieldId] ?? fieldId;
  return listFieldOfColumn(aliased, 'letter');
}

/** Колонки выгрузки/вида: видимые поля реестра, которые сервер знает. */
function visibleColumnsOf(fields: readonly { id: string }[]): ListViewColumn[] {
  return fields.flatMap((field) => {
    const listField = letterListFieldOfColumn(field.id);
    return listField === null ? [] : [{ field: listField as ListViewColumn['field'] }];
  });
}

/**
 * Список писем вкладки (#55, U6; редизайн #56 — и «Новые»): каноническая
 * таблица shared/views (свой viewKey на вкладку — своя память колонок и
 * фильтров), курсорная подгрузка sentinel-ом, СЕРВЕРНЫЙ поиск (№, тема,
 * их №, корреспондент; задержка 250 мс, прежние строки — до ответа), поля
 * фильтра и пресеты «Мне адресованы» / «Срок ответа истёк». #435: атрибуты
 * фильтрует сервер (предикаты общей выборки), сортировка по любой колонке
 * серверная, группировка и итоги — по всей выборке ящика, вид — «Сохранить
 * как вид» (личный), «Выгрузить CSV». Создание — только в «Новых» (бумажное
 * письмо; входящее из почты приходит само). Строка — карточка письма поверх
 * стека (префетч по ховеру); у «Новых» тема несёт личную точку «я ещё не
 * открывал» (`letter-table-fields`).
 */
export function LettersTable({ box }: { box: LetterBox }) {
  const copy = journal[box];
  const viewKey = `letters.${box}`;
  const toolbar = useListToolbar(viewKey, box === 'new' ? [] : letterBuiltinPresets);
  const ext = useListExt();
  const [activeViewId, setActiveViewId] = useState<string | undefined>(undefined);
  const search = useDebouncedValue(toolbar.query.trim(), 250);
  const { data: definitions } = useCustomFieldDefinitions('letter');
  const definitionList = useMemo(() => definitions ?? [], [definitions]);
  // Реестр колонок — хук: атрибуты писем (#632) приходят с сервера.
  const fields = useLetterTableFields({ box });
  // Атрибутные фильтры — предикаты на сервер (#435); запрос уже применил их —
  // локально только не переведённые поля.
  const split = useMemo(
    () => splitAttributeFilter(toolbar.filters, definitionList),
    [toolbar.filters, definitionList],
  );
  const extParams = useMemo<ListExtParams>(
    () => ({ ...ext.params, filter: split.predicates }),
    [ext.params, split.predicates],
  );
  // Один хук: без активного ext список идёт прежним конвейером (тот же URL
  // и ключ), с ext — серверным (#435).
  const activeQuery = useLettersInfinite(box, { search: search || undefined }, { ext: extParams });
  const serverRows = useMemo(() => letterRows(activeQuery.data), [activeQuery.data]);
  const defs = useLetterFilterDefs(serverRows, { box });
  const clientDefs = useMemo(
    () => defs.filter((def) => !split.serverFieldIds.has(def.id)),
    [defs, split.serverFieldIds],
  );
  const filter = useMemo<ActiveListFilter<LetterListItem>>(
    () => ({ defs: clientDefs, state: toolbar.filters, query: '' }),
    [clientDefs, toolbar.filters],
  );
  const rows = useFilteredList(serverRows, filter);
  const labeler = useGroupKeyLabeler('letter', definitions);
  const openCard = useOpenCard();
  const prefetch = usePrefetchLetter();
  const [manualOpen, setManualOpen] = useState(false);

  const savedViewsQuery = useJournalSavedViews('letter');
  const createView = useCreateSavedView();
  const deleteView = useDeleteSavedView();
  const exportCsv = useListExportAction();
  const savedViews = useMemo(
    () => (savedViewsQuery.data ?? []).map((view) => sanitizeSavedViewExt(view, definitionList)),
    [savedViewsQuery.data, definitionList],
  );
  const groupFields = useMemo(() => groupFieldOptions('letter', definitionList), [definitionList]);
  const numericFields = useMemo(
    () => numericFieldOptions('letter', definitionList),
    [definitionList],
  );

  const applySavedView = (saved: SavedView) => {
    toolbar.setFilters(predicatesToFilterState(saved.filter));
    ext.applyViewExt(saved);
    const visible = new Set<string>(saved.columns.map((column) => column.field));
    const byId = new Map(fields.map((f) => [f.id, f] as const));
    const ordered = [
      ...saved.columns.flatMap((column) => byId.get(column.field) ?? []),
      ...fields.filter((f) => !visible.has(f.id)),
    ];
    useViewStore.getState().applyOrder(
      viewKey,
      ordered.map((f) => ({ id: f.id, visible: visible.has(f.id) })),
    );
    setActiveViewId(saved.id);
  };

  const serverSort: ViewSort | null = ext.sort[0]
    ? {
        field: columnIdOfServerField(ext.sort[0].field),
        dir: ext.sort[0].dir,
      }
    : null;

  const failed = activeQuery.isError && !activeQuery.data;
  const pristine = activeQuery.isSuccess && rows.length === 0 && !search;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LettersHeader
        count={
          activeQuery.isSuccess ? `${rows.length}${activeQuery.hasNextPage ? '+' : ''}` : undefined
        }
      >
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={defs}
          builtinPresets={box === 'new' ? [] : letterBuiltinPresets}
          searchPlaceholder={ui.letters.list.searchPlaceholder}
          ext={{
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
            onSaveView: (name) =>
              createView.mutate(
                {
                  name,
                  entity: 'letter',
                  scope: { kind: 'journal' },
                  level: 'personal',
                  filter: split.predicates,
                  sort: ext.sort,
                  group: ext.group,
                  totals: ext.totals,
                  columns: visibleColumnsOf(fields),
                },
                {
                  onSuccess: (saved) => {
                    setActiveViewId(saved.id);
                    toast.success(ui.lists.panel.viewSaved);
                  },
                  onError: () => toast.error(ui.lists.panel.saveViewError),
                },
              ),
            onExportCsv: () =>
              void exportCsv({
                entity: 'letter',
                scope: { kind: 'journal' },
                filter: split.predicates,
                sort: ext.sort,
                columns: visibleColumnsOf(fields),
              }),
            removedFieldIds: [...split.removedFieldIds],
            onReset: () => {
              ext.reset();
              setActiveViewId(undefined);
            },
          }}
          // Закон кнопки создания (вердикт владельца 15.09.26): первый элемент
          // строки инструментов, СЛЕВА от поиска; бумажное письмо создают
          // только в очереди «Новые».
          left={
            box === 'new' ? (
              <Button onClick={() => setManualOpen(true)} className="shrink-0">
                <FilePlus2 data-icon="inline-start" />
                {ui.common.create}
              </Button>
            ) : undefined
          }
          right={<ViewSettings viewKey={viewKey} defs={fields} />}
        />
      </LettersHeader>
      <div className="min-h-0 flex-1">
        {failed ? (
          <LettersLoadError onRetry={() => void activeQuery.refetch()} />
        ) : pristine ? (
          <LettersEmpty icon={copy.icon} title={copy.empty} hint={copy.hint} />
        ) : (
          <DataTable
            viewKey={viewKey}
            /* Массовых действий у журнала писем нет — выбор строк не предлагаем (#962). */
            selectable={false}
            defs={fields}
            rows={rows}
            rowKey={letterKey}
            isLoading={activeQuery.isLoading}
            hasNextPage={activeQuery.hasNextPage}
            isFetchingNextPage={activeQuery.isFetchingNextPage}
            onLoadMore={() => void activeQuery.fetchNextPage()}
            label={copy.label}
            emptyTitle={ui.filters.notFound}
            onHoverRow={(letter) => prefetch(letter.id)}
            onOpenRow={(letter, rowEl) =>
              openCard({ kind: 'letter', id: letter.id }, rowEl.getBoundingClientRect())
            }
            rowMenu={(letter) => makeCardRowMenuItems({ kind: 'letter', id: letter.id }, openCard)}
            ext={{
              serverSort,
              onServerSortCycle: (fieldId) =>
                ext.cycleColumnSort(fieldId, (id) => letterListFieldOfColumn(id)),
              isServerSortable: (field: { id: string }) =>
                letterListFieldOfColumn(field.id) !== null,
              groups: ext.group
                ? {
                    buckets: activeQuery.data?.pages[0]?.groups ?? [],
                    keyOf: (letter) => letterRowValue(letter, ext.group!.field),
                    labelOf: (key) => labeler(ext.group!.field, key),
                  }
                : undefined,
              totals:
                ext.totals.length > 0
                  ? {
                      values: activeQuery.data?.pages[0]?.totals ?? [],
                      defs: ext.totals,
                    }
                  : undefined,
            }}
          />
        )}
      </div>
      {box === 'new' ? (
        <ManualLetterDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          onCreated={(created) => openCard({ kind: 'letter', id: created.id })}
        />
      ) : null}
    </div>
  );
}

/** Колонка реестра по полю сервера (обратная карта алиасов). */
function columnIdOfServerField(field: string): string {
  const aliased = Object.entries(LETTER_COLUMN_ALIASES).find(([, server]) => server === field);
  return aliased?.[0] ?? field;
}
