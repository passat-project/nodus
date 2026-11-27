import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
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

import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { CatalogPicker } from '../../../shared/ui/catalog-picker.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { NodeKindTile } from '../../../shared/ui/node-kind-icon.js';
import { DataTable, type DataTableField } from '../../../shared/views/data-table.js';
import { BulkIsland } from '../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { ListToolbar, ListToolbarSummary } from '../../../shared/views/list-toolbar.js';
import type { FilterFieldDef } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { kindIdsAfterToggle, visibleTypeKinds } from '../lib/project-type-summary.js';
import { kindRowSummary } from '../node-kinds/components/node-kind-summary.js';

/** Ключ вида: колонки и ширины общие для всех типов проектов (#857). */
const VIEW_KEY = 'processes.type-kinds';

/**
 * Вкладка «Какие папки здесь бывают» (#556; вкладка рамы типа — #857; модель
 * связей, вердикт владельца 27.11) — список ПОДКЛЮЧЁННЫХ типов папок, а не
 * весь справочник с тумблерами: «это же просто связи». Подключение — окном
 * пикера из справочника (`CatalogPicker`, по центру, с чекбоксами), создание
 * типов живёт у «+» колонки «Процессов», отключение — в меню строки и
 * пачкой (чекбоксы + островок). Клик по строке открывает настройку типа
 * папки поверх (компактное окно). `null` в `kindIds` — историческое «все
 * типы»: список показывает фактический набор, первое отключение делает его
 * явным.
 */
export function ProjectTypeKindsTab({
  type,
  kinds,
  canSetup,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
}) {
  const update = useUpdateProjectType();
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const updateTypeScope = useUpdateTypeCreation();
  const canManageWorkflows = useCanManageWorkflows();
  const toolbar = useListToolbar(VIEW_KEY);
  const openSettings = useTypeSettingsStore((s) => s.openSettings);

  const visible = visibleTypeKinds(type, kinds);
  const allowed = allowedNodeKinds(type.kindIds, visible);
  const allowedIds = allowed.map((kind) => kind.id);
  // Чекбоксы + островок: связи отключают и пачкой (вердикт владельца 27.11).
  const selection = useRowSelection(allowedIds);
  const selectedRows = allowed.filter((kind) => selection.selected.has(kind.id));
  const [pickerOpen, setPickerOpen] = useState(false);

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
      allowed.filter(
        (kind) =>
          !q ||
          kind.name.toLowerCase().includes(q) ||
          kindRowSummary(kind).toLowerCase().includes(q),
      ),
    [allowed, q],
  );
  /** Пикер: живые типы папок, которых ещё нет в подключённых. */
  const connectable = useMemo(
    () =>
      visible
        .filter((kind) => !allowedIds.includes(kind.id))
        .map((kind) => ({
          id: kind.id,
          name: kind.name,
          icon: <NodeKindTile icon={kind.icon} color={kind.color} className="size-6 rounded-md" />,
        })),
    [visible, allowedIds],
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
    <div className="@container flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<NodeKind>[]}
          left={
            canSetup ? (
              <Button onClick={() => setPickerOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.connectFolderKind}
              </Button>
            ) : null
          }
          right={
            <>
              <ListToolbarSummary>
                {ui.automation.entry.connectedSummary.replace('{count}', String(allowed.length))}
              </ListToolbarSummary>
              <ViewSettings viewKey={VIEW_KEY} defs={defs} />
            </>
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
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.automation.entry.connectedEmpty}
          // Тип папки — незначимая сущность: карточки у неё нет, строка
          // открывает компактное окно настроек этого типа.
          onOpenRow={(kind) => openSettings({ kind: 'node-kind', id: kind.id })}
          rowMenu={(kind) => [
            {
              id: 'settings',
              label: ui.automation.menuSettingsType,
              onSelect: () => openSettings({ kind: 'node-kind', id: kind.id }),
            },
            ...(canSetup
              ? [
                  {
                    id: 'disconnect',
                    label: ui.automation.entry.disconnect,
                    onSelect: () => toggle(kind.id, false),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <BulkIsland
        visible={canSetup && selectedRows.length > 0}
        count={selectedRows.length}
        ariaLabel={ui.projects.schemasKinds}
        onClear={selection.clear}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            for (const kind of selectedRows) toggle(kind.id, false);
            selection.clear();
          }}
        >
          {ui.automation.entry.disconnectSelected}
        </Button>
      </BulkIsland>
      <CatalogPicker
        title={ui.automation.entry.connectFolderKind}
        groups={[{ id: 'kind', label: ui.automation.entry.groups.folder, items: connectable }]}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConnect={(ids) => {
          for (const id of ids) toggle(id, true);
        }}
      />

      {canSetup && canManageWorkflows && boundWorks.length > 0 ? (
        <div className="shrink-0 px-6 pb-3">
          <PanelNote>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {ui.projects.schemasSuggestWorksNote}
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={allowBoundWorks}>
                <Check className="size-3.5" strokeWidth={1.75} />
                {ui.projects.schemasSuggestWorks}
              </Button>
            </span>
          </PanelNote>
        </div>
      ) : null}
    </div>
  );
}
