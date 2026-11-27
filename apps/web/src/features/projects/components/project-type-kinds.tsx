import { useMemo, useState } from 'react';
import { Check, Plus, RotateCcw } from 'lucide-react';
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

import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { NodeKindTile } from '../../../shared/ui/node-kind-icon.js';
import { DataTable, type DataTableField } from '../../../shared/views/data-table.js';
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
import { kindIdsAfterToggle, kindsSummary, visibleTypeKinds } from '../lib/project-type-summary.js';
import { NodeKindCreateDialog } from '../node-kinds/components/node-kind-create-dialog.js';
import { kindRowSummary } from '../node-kinds/components/node-kind-summary.js';

/** Ключ вида: колонки и ширины общие для всех типов проектов (#857). */
const VIEW_KEY = 'processes.type-kinds';

/**
 * Вкладка «Какие папки здесь бывают» (#556; вкладка рамы типа — #857; ревизия
 * UI v3) — СПИСОК в грамматике журналов портала: `ListToolbar` + таблица
 * `shared/views` на всю ширину вкладки, без чекбоксов и островка массовых
 * команд. Строка: значок + название, сводка формы, тумблер «тип доступен» в
 * ячейке действий. `null` в `kindIds` — все типы; снятие делает список явным,
 * возврат к полному набору снова пишет `null` (тихая команда справа в
 * тулбаре, рядом со сводкой). Клик по строке открывает карточку типа папки
 * ПОВЕРХ с анимацией из строки — рама остаётся на месте.
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
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.projects.schemasCreateKind}
              </Button>
            ) : null
          }
          right={
            <>
              <ListToolbarSummary>{kindsSummary(type, kinds)}</ListToolbarSummary>
              {canSetup && explicit && allowed.length < visible.length ? (
                <Button
                  variant="ghost"
                  onClick={() => update.mutate({ id: type.id, kindIds: null })}
                >
                  <RotateCcw data-icon="inline-start" />
                  {ui.projects.schemasResetKinds}
                </Button>
              ) : null}
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
          selectable={false}
          label={ui.projects.schemasKinds}
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.projects.schemasKindsEmpty}
          // Тип папки — незначимая сущность: карточки у неё нет, строка
          // открывает компактное окно настроек этого типа.
          onOpenRow={(kind) => openSettings({ kind: 'node-kind', id: kind.id })}
          rowMenu={(kind) => [
            {
              id: 'settings',
              label: ui.automation.menuSettingsType,
              onSelect: () => openSettings({ kind: 'node-kind', id: kind.id }),
            },
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
      </div>

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
    </div>
  );
}
