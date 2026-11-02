import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CustomFieldDefinition, CustomFieldScope } from '@nodus/contracts';
import { customFieldScopeSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useCanManageFields } from '../../../../shared/custom-fields/use-can-manage-fields.js';
import { SegmentedControl } from '../../../../shared/ui/segmented-control.js';
import { DataTable } from '../../../../shared/views/data-table.js';
import { ListToolbar } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';
import { useReorderCustomFields, useUpdateCustomField } from '../../api/custom-fields-api.js';
import { FieldBulkIsland } from './field-bulk-island.js';
import { fieldColumnsFor } from './field-columns.js';
import { FieldDeleteDialog } from './field-delete-dialog.js';
import { FieldDialog, type FieldDialogMode } from './field-dialog.js';
import { fieldRowMenu } from './field-row-menu.js';

const FIELD_SCOPES = customFieldScopeSchema.options;
const VIEW_KEY = 'custom-fields.list';

/** Подсказка области, значения которой ещё не пишутся (О5, #556): только
 *  контрагенты; задачи, письма, проекты и папки работают. */
function pendingHint(scope: CustomFieldScope): string | undefined {
  return (ui.customFields.scopePending as Partial<Record<CustomFieldScope, string>>)[scope];
}

/**
 * Вкладка «Атрибуты» «Автоматизации» (#431, ревизия UI 25.10.2026 —
 * вердикт владельца: «список по центру, как обычные сущности, как в
 * Битриксе»): шапка реестра по образцу журналов (заголовок + счётчик,
 * переключатель сущности пилюлей, «Создать» слева от поиска, шестерёнка
 * колонок), по центру — каноническая таблица `shared/views` с меню строки и
 * островком массовых действий. Клик по строке — окно атрибута. Порядок
 * строк = порядок атрибутов в карточке. Маршрут —
 * `/automation?tab=fields[&scope=<сущность>][&field=<id>]` (field — открыть окно).
 */
export function FieldsTab() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { scope?: string; field?: string };
  const scope: CustomFieldScope = customFieldScopeSchema.safeParse(search.scope).data ?? 'task';
  const canManage = useCanManageFields();
  const toolbar = useListToolbar(VIEW_KEY);
  const query = useCustomFieldDefinitions();
  const columns = useMemo(() => fieldColumnsFor(scope), [scope]);
  const all = useMemo(() => query.data ?? [], [query.data]);
  const inScope = useMemo(
    () =>
      all
        .filter((definition) => definition.scope === scope)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [all, scope],
  );
  const q = toolbar.query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      q
        ? inScope.filter(
            (definition) =>
              definition.name.toLowerCase().includes(q) ||
              (definition.hint ?? '').toLowerCase().includes(q),
          )
        : inScope,
    [inScope, q],
  );
  const rowKeys = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useRowSelection(rowKeys);
  const selectedRows = rows.filter((row) => selection.selected.has(row.id));

  const [creating, setCreating] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<CustomFieldDefinition[]>([]);
  const update = useUpdateCustomField();
  const reorder = useReorderCustomFields();
  const editing = all.find((definition) => definition.id === search.field) ?? null;
  const dialog: FieldDialogMode | null = editing
    ? { kind: 'edit', definition: editing }
    : creating
      ? { kind: 'create', scope }
      : null;

  const setSearch = (next: { scope?: CustomFieldScope; field?: string }) =>
    void navigate({ to: '/automation', search: (prev) => ({ ...prev, tab: 'fields', ...next }) });

  function move(row: CustomFieldDefinition, delta: -1 | 1) {
    const ids = inScope.map((definition) => definition.id);
    const from = ids.indexOf(row.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    reorder.mutate({ scope, ids });
  }

  function setHidden(targets: readonly CustomFieldDefinition[], hidden: boolean) {
    for (const target of targets) {
      if (target.hidden !== hidden) update.mutate({ id: target.id, body: { hidden } });
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="flex shrink-0 items-baseline gap-2 text-xl font-semibold text-balance text-foreground">
          {ui.customFields.page.title}
          <span className="inline-block min-w-8 font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
            {inScope.length}
          </span>
        </h1>
        <SegmentedControl
          value={scope}
          options={FIELD_SCOPES.map((value) => ({
            value,
            label: ui.customFields.scopes[value],
          }))}
          onChange={(value) => {
            selection.clear();
            setSearch({ scope: value, field: undefined });
          }}
          ariaLabel={ui.customFields.page.scopeSwitch}
          className="shrink-0 [&>button]:flex-none"
          size="sm"
          activeClassName="bg-accent text-foreground"
        />
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[]}
          searchPlaceholder={ui.customFields.page.searchPlaceholder}
          left={
            canManage ? (
              <Button onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" />
                {ui.common.create}
              </Button>
            ) : undefined
          }
          right={<ViewSettings viewKey={VIEW_KEY} defs={columns} />}
        />
      </div>
      {scope !== 'task' && pendingHint(scope) ? (
        <p className="-mt-1 shrink-0 px-6 pb-2 text-xs text-muted-foreground">
          {pendingHint(scope)}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={columns}
          rows={rows}
          rowKey={(definition) => definition.id}
          selection={selection}
          isLoading={query.isLoading}
          onOpenRow={(definition) => setSearch({ field: definition.id })}
          emptyTitle={q ? ui.customFields.page.emptySearch : ui.customFields.page.empty}
          rowMenu={(definition) =>
            fieldRowMenu({
              row: definition,
              index: q ? -1 : inScope.indexOf(definition),
              total: inScope.length,
              canManage,
              onEdit: (row) => setSearch({ field: row.id }),
              onMove: move,
              onSetHidden: (row, hidden) => setHidden([row], hidden),
              onDelete: (row) => setDeleteTargets([row]),
            })
          }
        />
      </div>
      {selectedRows.length > 0 ? <div aria-hidden className="h-24 shrink-0" /> : null}
      <FieldBulkIsland
        count={selectedRows.length}
        visible={canManage && selectedRows.length > 0}
        hasVisible={selectedRows.some((row) => !row.hidden)}
        hasHidden={selectedRows.some((row) => row.hidden)}
        pending={update.isPending}
        onSetHidden={(hidden) => setHidden(selectedRows, hidden)}
        onDelete={() => setDeleteTargets(selectedRows)}
        onClear={selection.clear}
      />

      {dialog ? (
        <FieldDialog
          key={dialog.kind === 'edit' ? dialog.definition.id : 'create'}
          mode={dialog}
          definitions={all}
          canManage={canManage}
          onClose={() => {
            setCreating(false);
            if (editing) setSearch({ field: undefined });
          }}
          onSaved={() => {
            setCreating(false);
            if (editing) setSearch({ field: undefined });
          }}
        />
      ) : null}
      {deleteTargets.length > 0 ? (
        <FieldDeleteDialog
          targets={deleteTargets}
          onClose={() => setDeleteTargets([])}
          onDeleted={(ids) => {
            for (const id of ids) selection.deselect(id);
            setDeleteTargets([]);
          }}
        />
      ) : null}
    </div>
  );
}
