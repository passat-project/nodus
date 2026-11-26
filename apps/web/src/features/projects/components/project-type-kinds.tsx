import { useMemo, useState } from 'react';
import { Check, Minus, Plus, RotateCcw } from 'lucide-react';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import {
  allowedNodeKinds,
  typeAllowedInProjectType,
  typeConfigOf,
  ui,
  withProjectTypeAllowed,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Switch } from '@nodus/ui/components/switch';

import { BulkIsland, bulkActionClass } from '../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { PanelAction } from '../../../shared/ui/panel/panel-kit.js';
import { NodeKindTile } from '../../../shared/ui/node-kind-icon.js';
import { DataTable, type DataTableField } from '../../../shared/views/data-table.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { FilterFieldDef } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { kindIdsAfterToggle, kindsSummary, visibleTypeKinds } from '../lib/project-type-summary.js';
import { NodeKindCreateDialog } from '../node-kinds/components/node-kind-create-dialog.js';
import { kindRowSummary } from '../node-kinds/components/node-kind-summary.js';

/** Ключ вида: колонки и ширины общие для всех типов проектов (#857). */
const VIEW_KEY = 'processes.type-kinds';

/**
 * Вкладка «Какие папки здесь бывают» (#556; вкладка рамы типа — #857) —
 * СПИСОК в грамматике журналов портала (вердикт владельца 26.11.2026):
 * `ListToolbar` + таблица `shared/views` на всю ширину вкладки. Строка:
 * значок+название, сводка формы, тумблер «тип доступен» в ячейке действий.
 * `null` в `kindIds` — все типы; снятие делает список явным, возврат к
 * полному набору снова пишет `null`. Клик по строке открывает карточку типа
 * папки справа (колонка стоит на месте).
 */
export function ProjectTypeKindsTab({
  type,
  kinds,
  canSetup,
  onOpenKind,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
  onOpenKind: (id: string) => void;
}) {
  const update = useUpdateProjectType();
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const updateTypeScope = useUpdateTypeCreation();
  const canManageWorkflows = useCanManageWorkflows();
  const toolbar = useListToolbar(VIEW_KEY);
  const [createOpen, setCreateOpen] = useState(false);

  const visible = visibleTypeKinds(type, kinds);
  const allowed = allowedNodeKinds(type.kindIds, visible);
  const allowedIds = allowed.map((kind) => kind.id);
  const explicit = type.kindIds !== null;

  // «Отметил тип — предложено разрешить привязанные типы работ» (#665):
  // у включённого типа есть работы, выключенные в этом типе проекта.
  const boundWorks = [...(tasks.data ?? []), ...(letters.data ?? [])].filter((item) => {
    const scope = typeConfigOf(item).creation;
    return (
      scope.folderKindId !== null &&
      allowedIds.includes(scope.folderKindId) &&
      !typeAllowedInProjectType(scope, type.id)
    );
  });

  const q = toolbar.query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      visible.filter(
        (kind) =>
          !q ||
          kind.name.toLowerCase().includes(q) ||
          kindRowSummary(kind).toLowerCase().includes(q),
      ),
    [visible, q],
  );

  function allowBoundWorks(): void {
    for (const item of boundWorks) {
      updateTypeScope.mutate({
        typeId: item.id,
        creation: withProjectTypeAllowed(typeConfigOf(item).creation, type.id, true),
      });
    }
  }

  function toggle(kindId: string, bound: boolean) {
    update.mutate({
      id: type.id,
      kindIds: kindIdsAfterToggle(type.kindIds, visible, kindId, bound),
    });
  }

  /** Пакетная правка доступности выбранных типов папок (островок). */
  function setAllowed(ids: readonly string[], bound: boolean) {
    const next = ids.reduce<string[] | null>(
      (acc, kindId) => kindIdsAfterToggle(acc, visible, kindId, bound),
      type.kindIds,
    );
    update.mutate({ id: type.id, kindIds: next });
  }

  const rowKeys = useMemo(() => rows.map((kind) => kind.id), [rows]);
  const selection = useRowSelection(rowKeys);
  const selectedIds = useMemo(() => [...selection.selected], [selection.selected]);

  const defs = useMemo<DataTableField<NodeKind>[]>(
    () => [
      {
        id: 'name',
        label: ui.projects.fieldName,
        defaultVisible: true,
        defaultWidth: 260,
        minWidth: 170,
        maxWidth: 300,
        locked: true,
        render: (kind) => (
          <>
            <NodeKindTile icon={kind.icon} color={kind.color} className="size-7 rounded-md" />
            <span className="truncate text-sm font-medium">{kind.name}</span>
            {kind.archivedAt !== null ? (
              <NodeChip tone="muted" className="shrink-0">
                {ui.projects.schemasKindArchived}
              </NodeChip>
            ) : null}
          </>
        ),
        sortValue: (kind) => kind.name,
      },
      {
        id: 'form',
        label: ui.structure.propertiesAttributes,
        defaultVisible: true,
        defaultWidth: 320,
        minWidth: 160,
        maxWidth: 340,
        flex: true,
        render: (kind) => (
          <span className="truncate text-sm text-muted-foreground" title={kindRowSummary(kind)}>
            {kindRowSummary(kind)}
          </span>
        ),
        sortValue: (kind) => kindRowSummary(kind),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<NodeKind>[]}
          right={<ViewSettings viewKey={VIEW_KEY} defs={defs} />}
          left={
            canSetup ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.projects.schemasCreateKind}
              </Button>
            ) : null
          }
        />
      </CardTabToolbar>

      <div className="relative min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={defs}
          rows={rows}
          rowKey={(kind) => kind.id}
          selection={selection}
          label={ui.projects.schemasKinds}
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.projects.schemasKindsEmpty}
          onOpenRow={(kind) => onOpenKind(kind.id)}
          rowMenu={(kind) => [
            { id: 'open', label: ui.common.open, onSelect: () => onOpenKind(kind.id) },
          ]}
          actions={(kind) => (
            <Switch
              checked={allowedIds.includes(kind.id)}
              disabled={!canSetup}
              aria-label={`${kind.name}: ${ui.projects.schemasKindAvailable}`}
              onCheckedChange={(checked) => toggle(kind.id, checked)}
            />
          )}
        />
        <BulkIsland
          visible={canSetup && selectedIds.length > 0}
          count={selectedIds.length}
          ariaLabel={ui.projects.schemasKinds}
          onClear={selection.clear}
        >
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={canSetup && selectedIds.length > 0 ? 0 : -1}
            onClick={() => setAllowed(selectedIds, true)}
          >
            <Check className="size-4" strokeWidth={1.75} />
            {ui.projects.schemasKindAllow}
          </button>
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={canSetup && selectedIds.length > 0 ? 0 : -1}
            onClick={() => setAllowed(selectedIds, false)}
          >
            <Minus className="size-4" strokeWidth={1.75} />
            {ui.projects.schemasKindDeny}
          </button>
        </BulkIsland>
      </div>

      {createOpen ? (
        <NodeKindCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            // При «все типы» новый тип уже разрешён — явный список не нужен.
            if (type.kindIds !== null) {
              update.mutate({
                id: type.id,
                kindIds: kindIdsAfterToggle(type.kindIds, visible, id, true),
              });
            }
          }}
        />
      ) : null}

      {canSetup && explicit && allowed.length < visible.length ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-2">
          <PanelAction
            icon={RotateCcw}
            onClick={() => update.mutate({ id: type.id, kindIds: null })}
          >
            {ui.projects.schemasResetKinds}
          </PanelAction>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {kindsSummary(type, kinds)}
          </span>
        </div>
      ) : null}

      {canSetup && canManageWorkflows && boundWorks.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 px-6 py-2">
          <PanelAction icon={Check} onClick={allowBoundWorks}>
            {ui.projects.schemasSuggestWorks}
          </PanelAction>
        </div>
      ) : null}
    </div>
  );
}
