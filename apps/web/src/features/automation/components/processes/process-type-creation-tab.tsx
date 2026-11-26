import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';
import { Check, Minus, Plus, RotateCcw } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { CardTabToolbar } from '../../../../shared/ui/entity-card/card-tab-toolbar.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { PanelAction } from '../../../../shared/ui/panel/panel-kit.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { BulkIsland, bulkActionClass } from '../../../../shared/views/bulk-island.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
import type { FilterFieldDef } from '../../../../shared/views/list-filters.js';
import { ListToolbar } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';

/** Ключ вида: колонки и ширины общие у всех типов (#857). */
const VIEW_KEY = 'processes.type-scope';

/**
 * Вкладка «Где создаётся» типа задачи/письма (#665, ADR-0041 п.9; ревизия
 * вкладок 26.11.2026) — БОЛЬШАЯ поверхность: список типов проектов в
 * грамматике журналов портала на всю ширину вкладки. Тумблер — элемент
 * строки, «разрешён везде» снимает все исключения. Главная кнопка создаёт
 * тип проекта (он разрешает все типы по умолчанию — связка сразу).
 */
export function ProcessTypeCreationTab({
  type,
  canSave,
  renderProjectTypeCreate,
}: {
  type: ProcessType;
  canSave: boolean;
  /** Окно создания типа проекта (слот фичи projects, I6). */
  renderProjectTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}) {
  const projectTypes = useProjectTypes();
  const kindsQuery = useNodeKinds();
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  const [createOpen, setCreateOpen] = useState(false);

  const scope = typeConfigOf(type).creation;
  const kinds = useMemo(
    () => (kindsQuery.data ?? []).filter((kind) => kind.archivedAt === null),
    [kindsQuery.data],
  );
  /** Сводка типов папок типа проекта — локально (кросс-фичевый импорт запрещён). */
  const kindsText = useCallback(
    (projectType: ProjectType): string =>
      projectType.kindIds === null
        ? ui.projects.schemasKindsSummaryAll.replace('{count}', String(kinds.length))
        : ui.projects.schemasKindsSummary
            .replace('{allowed}', String(allowedNodeKinds(projectType.kindIds, kinds).length))
            .replace('{total}', String(kinds.length)),
    [kinds],
  );
  const rows = useMemo(
    () => (projectTypes.data ?? []).filter((item) => item.archivedAt === null),
    [projectTypes.data],
  );
  const q = toolbar.query.trim().toLowerCase();
  const filtered = useMemo(
    () => rows.filter((item) => !q || item.name.toLowerCase().includes(q)),
    [rows, q],
  );

  /** Созданный тип проекта разрешает этот тип по умолчанию — связка уже есть;
   *  после ответа список перечитан, строка появится включённой. */
  const onCreated = () => {
    setCreateOpen(false);
  };

  function save(excludedProjectTypeIds: string[]) {
    update.mutate({ typeId: type.id, creation: { ...scope, excludedProjectTypeIds } });
  }

  function toggle(projectTypeId: string, allowed: boolean) {
    save(withProjectTypeAllowed(scope, projectTypeId, allowed).excludedProjectTypeIds);
  }

  const rowKeys = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useRowSelection(rowKeys);
  const selectedRows = useMemo(
    () => filtered.filter((item) => selection.selected.has(item.id)),
    [filtered, selection.selected],
  );

  function setAllowed(items: readonly ProjectType[], allowed: boolean) {
    let next = [...scope.excludedProjectTypeIds];
    for (const item of items) {
      const allowedAfter = withProjectTypeAllowed(
        { ...scope, excludedProjectTypeIds: next },
        item.id,
        allowed,
      );
      next = [...allowedAfter.excludedProjectTypeIds];
    }
    save(next);
  }

  const defs = useMemo<DataTableField<ProjectType>[]>(
    () => [
      {
        id: 'name',
        label: ui.projects.fieldName,
        defaultVisible: true,
        defaultWidth: 280,
        minWidth: 180,
        maxWidth: 320,
        locked: true,
        render: (projectType) => (
          <>
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md border',
                identityTone[projectType.color].tile,
              )}
            >
              <ProcessTypeGlyph icon={projectType.icon} className="size-3.5" />
            </span>
            <span className="truncate text-sm font-medium">{projectType.name}</span>
          </>
        ),
        sortValue: (projectType) => projectType.name,
      },
      {
        id: 'kinds',
        label: ui.projects.schemasKindsColumn,
        defaultVisible: true,
        defaultWidth: 260,
        minWidth: 160,
        maxWidth: 320,
        flex: true,
        render: (projectType) => (
          <span className="truncate text-sm text-muted-foreground">{kindsText(projectType)}</span>
        ),
      },
    ],
    [kindsText],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProjectType>[]}
          left={
            canSave ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.createProjectType}
              </Button>
            ) : undefined
          }
          right={<ViewSettings viewKey={VIEW_KEY} defs={defs} />}
        />
      </CardTabToolbar>
      {canSave && scope.excludedProjectTypeIds.length > 0 ? (
        <div className="px-6 pb-2">
          <PanelAction icon={RotateCcw} onClick={() => save([])}>
            {ui.automation.creationScope.allowAll}
          </PanelAction>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={defs}
          rows={filtered}
          rowKey={(projectType) => projectType.id}
          selection={selection}
          label={ui.automation.creationScope.sectionTitle}
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.projects.typesEmpty}
          onOpenRow={() => undefined}
          rowMenu={() => []}
          actions={(projectType) => (
            <Switch
              checked={!scope.excludedProjectTypeIds.includes(projectType.id)}
              disabled={!canSave || update.isPending}
              aria-label={`${projectType.name}: ${ui.automation.creationScope.projectTypeRow}`}
              onCheckedChange={(checked) => toggle(projectType.id, checked)}
            />
          )}
        />
      </div>
      <BulkIsland
        visible={canSave && selectedRows.length > 0}
        count={selectedRows.length}
        ariaLabel={ui.automation.creationScope.sectionTitle}
        onClear={selection.clear}
      >
        <button
          type="button"
          className={bulkActionClass}
          tabIndex={canSave && selectedRows.length > 0 ? 0 : -1}
          onClick={() => setAllowed(selectedRows, true)}
        >
          <Check className="size-4" strokeWidth={1.75} />
          {ui.automation.creationScope.bulkAllow}
        </button>
        <button
          type="button"
          className={bulkActionClass}
          tabIndex={canSave && selectedRows.length > 0 ? 0 : -1}
          onClick={() => setAllowed(selectedRows, false)}
        >
          <Minus className="size-4" strokeWidth={1.75} />
          {ui.automation.creationScope.bulkDeny}
        </button>
      </BulkIsland>
      {createOpen && renderProjectTypeCreate
        ? renderProjectTypeCreate({ onClose: () => setCreateOpen(false), onCreated })
        : null}
    </div>
  );
}
