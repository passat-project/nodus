import { useMemo, useState } from 'react';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Plus } from 'lucide-react';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { CatalogPicker, CatalogPickerTile } from '../../../shared/ui/catalog-picker.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { DataTable, type DataTableField } from '../../../shared/views/data-table.js';
import { BulkIsland } from '../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { ListToolbar, ListToolbarSummary } from '../../../shared/views/list-toolbar.js';
import type { FilterFieldDef } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../shared/workflow/type-tone.js';

/** Ключ вида: колонки и ширины общие для всех типов проектов (#857). */
const VIEW_KEY = 'processes.type-creation';

/** Тип подключён к типу проекта: исключения хранит сам тип (#665). */
function connectedTo(item: ProcessType, projectTypeId: string): boolean {
  return !typeConfigOf(item).creation.excludedProjectTypeIds.includes(projectTypeId);
}

/**
 * Вкладка «Что здесь можно создавать» (#665, ADR-0041 п.9; модель связей,
 * вердикт владельца 27.11) — список ПОДКЛЮЧЁННЫХ типов задач, а не весь
 * справочник с тумблерами: «это же просто связи». Подключение — пикером из
 * справочника (`CatalogPicker`), создание типов живёт у «+» колонки
 * «Процессов», отключение — в меню строки. Клик по строке открывает карточку
 * типа задачи ПОВЕРХ с анимацией из строки. Запись — в настройку САМОГО
 * типа: вторая сторона связи («Где создаётся») показывает то же самое.
 * Письма системные (ADR-0027): их связь с типами проектов настраивается на
 * их стороне («Где создаётся»), здесь их нет — пикер писем в будущем.
 */
export function ProjectTypeCreationTab({
  type,
  canSetup,
}: {
  type: ProjectType;
  canSetup: boolean;
}) {
  const tasks = useLiveProcessTypes('task');
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  const openCard = useOpenCard();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);
  // Запись связи требует `workflow.manage` (сервер — истина, I8): у настройщика
  // типов проектов без права процессов список только читается, а не даёт 403.
  const canManage = useCanManageWorkflows();
  const canSave = canSetup && canManage;

  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  const connected = useMemo(
    () => rows.filter((item) => connectedTo(item, type.id)),
    [rows, type.id],
  );
  // Чекбоксы + островок: связи отключают и пачкой (вердикт владельца 27.11).
  const selection = useRowSelection(connected.map((item) => item.id));
  const selectedRows = connected.filter((item) => selection.selected.has(item.id));
  const [pickerOpen, setPickerOpen] = useState(false);

  const q = toolbar.query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      connected.filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          (item.description ?? '').toLowerCase().includes(q),
      ),
    [connected, q],
  );

  function setAllowed(item: ProcessType, allowed: boolean): void {
    const scope = typeConfigOf(item).creation;
    // Отключение работы, привязанной к разрешённому типу папки, —
    // предупреждение: её нельзя будет создать даже в папке (issue #665).
    const boundHere =
      !allowed &&
      scope.folderKindId !== null &&
      (type.kindIds === null || type.kindIds.includes(scope.folderKindId));
    if (boundHere) toast.warning(ui.automation.creationScope.unbindWarning);
    update.mutate({ typeId: item.id, creation: withProjectTypeAllowed(scope, type.id, allowed) });
  }

  /** Пикер: неподключённые живые типы задач справочника. */
  const connectable = useMemo(
    () =>
      rows
        .filter((item) => !connectedTo(item, type.id))
        .map((item) => ({
          id: item.id,
          name: item.name,
          icon: (
            <CatalogPickerTile className={typeToneOf(item.color)}>
              <ProcessTypeGlyph icon={item.icon} className="size-3" />
            </CatalogPickerTile>
          ),
        })),
    [rows, type.id],
  );

  const defs = useMemo<DataTableField<ProcessType>[]>(
    () => [
      {
        id: 'name',
        label: ui.projects.fieldName,
        defaultVisible: true,
        defaultWidth: 260,
        minWidth: 170,
        maxWidth: 300,
        locked: true,
        render: (item) => (
          <>
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md border',
                typeToneOf(item.color),
              )}
            >
              <ProcessTypeGlyph icon={item.icon} className="size-3.5" />
            </span>
            <span className="truncate text-sm font-medium">{item.name}</span>
          </>
        ),
        sortValue: (item) => item.name,
      },
      {
        id: 'description',
        label: ui.projects.fieldDescription,
        defaultVisible: true,
        defaultWidth: 260,
        minWidth: 160,
        maxWidth: 240,
        flex: true,
        render: (item) =>
          item.description ? (
            <span className="truncate text-sm text-muted-foreground" title={item.description}>
              {item.description}
            </span>
          ) : null,
        sortValue: (item) => item.description ?? '',
      },
    ],
    [],
  );

  return (
    <div className="@container relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProcessType>[]}
          left={
            canSave ? (
              <Button onClick={() => setPickerOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.connectTaskType}
              </Button>
            ) : undefined
          }
          right={
            <>
              <ListToolbarSummary>
                {ui.automation.entry.connectedSummary.replace('{count}', String(connected.length))}
              </ListToolbarSummary>
              <ViewSettings viewKey={VIEW_KEY} defs={defs} />
            </>
          }
        />
      </CardTabToolbar>
      {canSetup && !canSave ? (
        <div className="px-6 pb-2">
          <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={defs}
          rows={filtered}
          rowKey={(item) => item.id}
          selection={selection}
          label={ui.projects.schemasCreationPage}
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.automation.entry.connectedEmpty}
          onOpenRow={(item, rowEl) =>
            openCard({ kind: 'process-type', id: item.id }, rowEl.getBoundingClientRect())
          }
          rowMenu={(item) => [
            {
              id: 'open',
              label: ui.common.open,
              onSelect: () => openCard({ kind: 'process-type', id: item.id }),
            },
            {
              id: 'settings',
              label: ui.automation.menuSettingsType,
              onSelect: () => openSettings({ kind: 'process-type', id: item.id }),
            },
            ...(canSave
              ? [
                  {
                    id: 'disconnect',
                    label: ui.automation.entry.disconnect,
                    onSelect: () => setAllowed(item, false),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <BulkIsland
        visible={canSave && selectedRows.length > 0}
        count={selectedRows.length}
        ariaLabel={ui.projects.schemasCreationPage}
        onClear={selection.clear}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            for (const item of selectedRows) setAllowed(item, false);
            selection.clear();
          }}
        >
          {ui.automation.entry.disconnectSelected}
        </Button>
      </BulkIsland>
      <CatalogPicker
        title={ui.automation.entry.connectTaskType}
        groups={[{ id: 'task', label: ui.automation.entry.groups.task, items: connectable }]}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConnect={(ids) => {
          for (const id of ids) {
            const item = rows.find((row) => row.id === id);
            if (item) setAllowed(item, true);
          }
        }}
      />
    </div>
  );
}
