import { useMemo, useState } from 'react';
import type { ProcessType } from '@nodus/contracts';
import { typeConfigOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Plus } from 'lucide-react';
import { cn } from '@nodus/ui/lib/utils';

import { useOpenCard } from '../../../../app/shell/use-card-stack.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { CatalogPicker, CatalogPickerTile } from '../../../../shared/ui/catalog-picker.js';
import { PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { TypeCardFrame } from '../../../../shared/ui/type-card-frame.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../../shared/workflow/type-tone.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
import { BulkIsland } from '../../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';
import type { FilterFieldDef } from '../../../../shared/views/list-filters.js';
import { ListToolbar, ListToolbarSummary } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';

/** Ключ вида: колонки и ширины общие у всех типов проекта (#857). */
const VIEW_KEY = 'processes.no-project';

/**
 * «Без проекта» в разделе «Процессы» (#857, единая модель §4; модель связей,
 * вердикт владельца 27.11) — ТА ЖЕ рама карточки, что у типа проекта/папки,
 * без вкладок: список типов задач, ПОДКЛЮЧЁННЫХ к «без проекта» (не весь
 * справочник с тумблерами). Подключение — пикером из справочника, создание
 * типов — у «+» колонки, отключение — в меню строки. Клик по строке открывает
 * карточку типа задачи ПОВЕРХ с анимацией из строки. Запись — через настройку
 * самого типа (`creation.withoutProject`, вторая сторона — «Где создаётся»).
 * Без права `workflow.manage` — только просмотр с пояснением (паттерн #665, I8).
 */
export function WithoutProjectPage({ canManage }: { canManage: boolean }) {
  const tasks = useLiveProcessTypes('task');
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  const openCard = useOpenCard();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);

  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  const connected = useMemo(
    () => rows.filter((type) => typeConfigOf(type).creation.withoutProject),
    [rows],
  );
  // Чекбоксы + островок: связи отключают и пачкой (вердикт владельца 27.11).
  const selection = useRowSelection(connected.map((type) => type.id));
  const selectedRows = connected.filter((type) => selection.selected.has(type.id));
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Пикер: типы задач, которым «без проекта» ещё не разрешён. */
  const connectable = useMemo(
    () =>
      rows
        .filter((type) => !typeConfigOf(type).creation.withoutProject)
        .map((type) => ({
          id: type.id,
          name: type.name,
          icon: (
            <CatalogPickerTile className={typeToneOf(type.color)}>
              <ProcessTypeGlyph icon={type.icon} className="size-3" />
            </CatalogPickerTile>
          ),
        })),
    [rows],
  );

  function setAllowed(type: ProcessType, allowed: boolean) {
    const scope = typeConfigOf(type).creation;
    update.mutate({ typeId: type.id, creation: { ...scope, withoutProject: allowed } });
  }

  const q = toolbar.query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      connected.filter(
        (type) =>
          !q ||
          type.name.toLowerCase().includes(q) ||
          (type.description ?? '').toLowerCase().includes(q),
      ),
    [connected, q],
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
        render: (type) => (
          <>
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md border',
                typeToneOf(type.color),
              )}
            >
              <ProcessTypeGlyph icon={type.icon} className="size-3.5" />
            </span>
            <span className="truncate text-sm font-medium">{type.name}</span>
          </>
        ),
        sortValue: (type) => type.name,
      },
      {
        id: 'description',
        label: ui.projects.fieldDescription,
        defaultVisible: true,
        defaultWidth: 280,
        minWidth: 160,
        maxWidth: 280,
        flex: true,
        render: (type) =>
          type.description ? (
            <span className="truncate text-sm text-muted-foreground" title={type.description}>
              {type.description}
            </span>
          ) : null,
        sortValue: (type) => type.description ?? '',
      },
    ],
    [],
  );

  return (
    <TypeCardFrame
      bar={
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProcessType>[]}
          left={
            canManage ? (
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
      }
    >
      <div className="relative flex h-full min-h-0 flex-col">
        {!canManage ? (
          <div className="px-6 pt-2">
            <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <DataTable
            viewKey={VIEW_KEY}
            defs={defs}
            rows={filtered}
            rowKey={(type) => type.id}
            selection={selection}
            label={ui.automation.creationScope.tasksGroup}
            emptyTitle={q ? ui.automation.entry.searchEmpty : ui.automation.entry.connectedEmpty}
            onOpenRow={(type, rowEl) =>
              openCard({ kind: 'process-type', id: type.id }, rowEl.getBoundingClientRect())
            }
            rowMenu={(type) => [
              {
                id: 'open',
                label: ui.common.open,
                onSelect: () => openCard({ kind: 'process-type', id: type.id }),
              },
              {
                id: 'settings',
                label: ui.automation.menuSettingsType,
                onSelect: () => openSettings({ kind: 'process-type', id: type.id }),
              },
              ...(canManage
                ? [
                    {
                      id: 'disconnect',
                      label: ui.automation.entry.disconnect,
                      onSelect: () => setAllowed(type, false),
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <BulkIsland
          visible={canManage && selectedRows.length > 0}
          count={selectedRows.length}
          ariaLabel={ui.automation.entry.noProjectTitle}
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
      </div>
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
    </TypeCardFrame>
  );
}
