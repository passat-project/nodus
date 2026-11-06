import { useNavigate, useSearch } from '@tanstack/react-router';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CustomFieldDefinition, CustomFieldModule } from '@nodus/contracts';
import { customFieldModuleSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useCanManageFields } from '../../../../shared/custom-fields/use-can-manage-fields.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { useReorderCustomFields, useSetCompanyValue } from '../../api/custom-fields-api.js';
import { DataTable } from '../../../../shared/views/data-table.js';
import { ListToolbar } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';
import { FieldBulkIsland } from './field-bulk-island.js';
import { fieldColumns, FIELD_MODULES } from './field-columns.js';
import { FieldDeleteDialog } from './field-delete-dialog.js';
import { FieldDialog, type FieldDialogMode } from './field-dialog.js';
import { fieldRowMenu } from './field-row-menu.js';

const VIEW_KEY = 'custom-fields.list';

/** Фильтр модуля — выпадающий чип (Р11): Все / Задачи / Письма / Проекты /
 *  Папки / Глобальные. «Реестры» добавит #636 (В6). */
function ModuleFilter({
  value,
  onChange,
}: {
  value: CustomFieldModule | 'all';
  onChange: (next: CustomFieldModule | 'all') => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-auto shrink-0 justify-start gap-1.5 px-2 text-sm"
        >
          <span className="text-muted-foreground">{ui.customFields.page.moduleFilter}:</span>
          <span>{ui.customFields.modules[value]}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      {/* Ширина списка = ширина чипа (минимум ради самого длинного пункта),
          выравнивание по чипу — канон селектов. */}
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-36"
      >
        {FIELD_MODULES.map((module) => (
          <DropdownMenuItem
            key={module}
            onSelect={() => onChange(module)}
            className={cn(module === value && 'font-medium')}
          >
            <span className="flex-1">{ui.customFields.modules[module]}</span>
            {module === value ? (
              <Check className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Вкладка «Атрибуты» «Автоматизации» (#431, ревизия #631 — один атрибут на
 * весь портал): ОДНА таблица всех атрибутов портала с колонкой «Где
 * используется» и фильтром-модулем вместо переключателя областей; порядок
 * строк = порядок атрибутов в карточках (глобальный sortOrder, «Поднять/
 * Опустить» и массовое удаление как раньше). Клик по строке — окно
 * атрибута. Маршрут — `/automation?tab=fields[&module=<модуль>][&field=<id>]`
 * (field — открыть окно, module — фильтр реестра).
 */
export function FieldsTab() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { module?: string; field?: string };
  const module = customFieldModuleSchema.safeParse(search.module).data ?? 'all';
  const canManage = useCanManageFields();
  const toolbar = useListToolbar(VIEW_KEY);
  const query = useCustomFieldDefinitions();
  const { data: processTypes } = useProcessTypes();
  const all = useMemo(() => query.data ?? [], [query.data]);
  const setCompanyValue = useSetCompanyValue();
  const columns = useMemo(
    () =>
      fieldColumns(canManage, (definition, value) =>
        setCompanyValue.mutate({ fieldId: definition.id, value }),
      ),
    [canManage, setCompanyValue],
  );

  // Задачи и письма делят processTypeIds — разбивку дают категории типов.
  const typeCategories = useMemo(
    () => ({
      taskTypeIds: new Set(
        (processTypes ?? []).filter((type) => type.category === 'task').map((type) => type.id),
      ),
      letterTypeIds: new Set(
        (processTypes ?? []).filter((type) => type.category === 'letter').map((type) => type.id),
      ),
    }),
    [processTypes],
  );
  const inModuleRows = useMemo(() => {
    const matches = (definition: CustomFieldDefinition): boolean => {
      if (module === 'all') return true;
      if (module === 'company') return definition.isCompany;
      const { processTypeIds, projectTypeIds, nodeKindIds } = definition.bindings;
      switch (module) {
        case 'task':
          return processTypeIds.some((id) => typeCategories.taskTypeIds.has(id));
        case 'letter':
          return processTypeIds.some((id) => typeCategories.letterTypeIds.has(id));
        case 'project':
          return projectTypeIds.length > 0;
        case 'node':
          return nodeKindIds.length > 0;
      }
    };
    return all
      .filter(matches)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }, [all, module, typeCategories]);
  const q = toolbar.query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      q
        ? inModuleRows.filter(
            (definition) =>
              definition.name.toLowerCase().includes(q) ||
              (definition.hint ?? '').toLowerCase().includes(q),
          )
        : inModuleRows,
    [inModuleRows, q],
  );
  const rowKeys = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useRowSelection(rowKeys);
  const selectedRows = rows.filter((row) => selection.selected.has(row.id));

  const [creating, setCreating] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<CustomFieldDefinition[]>([]);
  const reorder = useReorderCustomFields();
  const editing = all.find((definition) => definition.id === search.field) ?? null;
  const dialog: FieldDialogMode | null = editing
    ? { kind: 'edit', definition: editing }
    : creating
      ? { kind: 'create' }
      : null;

  const setSearch = (next: { module?: string; field?: string }) =>
    void navigate({ to: '/automation', search: (prev) => ({ ...prev, tab: 'fields', ...next }) });

  function move(row: CustomFieldDefinition, delta: -1 | 1) {
    const ids = all.map((definition) => definition.id);
    const from = ids.indexOf(row.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    reorder.mutate({ ids });
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="flex shrink-0 items-baseline gap-2 text-xl font-semibold text-balance text-foreground">
          {ui.customFields.page.title}
          <span className="inline-block min-w-8 font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
            {all.length}
          </span>
        </h1>
        <ModuleFilter value={module} onChange={(value) => setSearch({ module: value })} />
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
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={columns}
          rows={rows}
          rowKey={(definition) => definition.id}
          selection={selection}
          isLoading={query.isLoading}
          onOpenRow={(definition) => setSearch({ field: definition.id })}
          emptyTitle={
            q
              ? ui.customFields.page.emptySearch
              : module === 'company'
                ? ui.customFields.page.emptyCompany
                : ui.customFields.page.empty
          }
          rowMenu={(definition) =>
            fieldRowMenu({
              row: definition,
              // Порядок глобальный (весь портал), а фильтр/поиск показывают
              // подмножество: движение по глобальному списку выглядело бы
              // «прыжком мимо невидимых». При фильтре — без перемещения.
              index: q || module !== 'all' ? -1 : inModuleRows.indexOf(definition),
              total: inModuleRows.length,
              canManage,
              onEdit: (row) => setSearch({ field: row.id }),
              onMove: move,
              onDelete: (row) => setDeleteTargets([row]),
            })
          }
        />
      </div>
      {/* Островок массовых действий всплывает ПОВЕРХ списка (как в журнале
          задач) — без резерва места под ним: резервная полоса под таблицей
          читалась чужой заливкой (вердикт владельца 06.11, чекпоинт #631). */}
      <FieldBulkIsland
        count={selectedRows.length}
        visible={canManage && selectedRows.length > 0}
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
          onOpenDefinition={(definitionId) => {
            setCreating(false);
            setSearch({ field: definitionId });
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
