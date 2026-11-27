import { useCallback, useMemo, useState } from 'react';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { Plus } from 'lucide-react';

import { useOpenCard } from '../../../../app/shell/use-card-stack.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { CardTabToolbar } from '../../../../shared/ui/entity-card/card-tab-toolbar.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { CatalogPicker, CatalogPickerTile } from '../../../../shared/ui/catalog-picker.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
import { BulkIsland } from '../../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';
import type { FilterFieldDef } from '../../../../shared/views/list-filters.js';
import { ListToolbar, ListToolbarSummary } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';

/** Ключ вида: колонки и ширины общие у всех типов (#857). */
const VIEW_KEY = 'processes.type-scope';

/**
 * Вкладка «Где создаётся» типа задачи/письма (#665, ADR-0041 п.9; модель
 * связей, вердикт владельца 27.11) — список типов проектов, к которым тип
 * ПОДКЛЮЧЁН, а не весь справочник с тумблерами. Подключение — пикером из
 * справочника (`CatalogPicker`), создание типов проектов живёт у «+»
 * колонки «Процессов», отключение — в меню строки. Клик по строке открывает
 * карточку типа проекта ПОВЕРХ с анимацией из строки. Обе стороны связи
 * пишут в настройку САМОГО типа — в типе проекта видно то же самое.
 */
export function ProcessTypeCreationTab({ type, canSave }: { type: ProcessType; canSave: boolean }) {
  const projectTypes = useProjectTypes();
  const kindsQuery = useNodeKinds();
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  const openCard = useOpenCard();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);

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
  /** Тип проекта подключён к этому типу записи: исключения хранит сам тип. */
  const connectedTo = useCallback(
    (projectType: ProjectType) => !scope.excludedProjectTypeIds.includes(projectType.id),
    [scope.excludedProjectTypeIds],
  );
  const rows = useMemo(
    () => (projectTypes.data ?? []).filter((item) => item.archivedAt === null && connectedTo(item)),
    [projectTypes.data, connectedTo],
  );
  // Чекбоксы + островок: связи отключают и пачкой (вердикт владельца 27.11).
  const selection = useRowSelection(rows.map((item) => item.id));
  const selectedRows = rows.filter((item) => selection.selected.has(item.id));
  const [pickerOpen, setPickerOpen] = useState(false);
  const q = toolbar.query.trim().toLowerCase();
  const filtered = useMemo(
    () => rows.filter((item) => !q || item.name.toLowerCase().includes(q)),
    [rows, q],
  );
  /** Пикер: живые типы проектов, куда тип ещё не подключён. */
  const connectable = useMemo(
    () =>
      (projectTypes.data ?? [])
        .filter((item) => item.archivedAt === null && !connectedTo(item))
        .map((item) => ({
          id: item.id,
          name: item.name,
          icon: (
            <CatalogPickerTile className={identityTone[item.color].tile}>
              <ProcessTypeGlyph icon={item.icon} className="size-3" />
            </CatalogPickerTile>
          ),
        })),
    [projectTypes.data, connectedTo],
  );

  function setAllowed(projectTypeId: string, allowed: boolean) {
    update.mutate({
      typeId: type.id,
      creation: withProjectTypeAllowed(scope, projectTypeId, allowed),
    });
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
    <div className="@container relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProjectType>[]}
          left={
            canSave ? (
              <Button onClick={() => setPickerOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.connectProjectType}
              </Button>
            ) : undefined
          }
          right={
            <>
              <ListToolbarSummary>
                {ui.automation.entry.connectedSummary.replace('{count}', String(rows.length))}
              </ListToolbarSummary>
              <ViewSettings viewKey={VIEW_KEY} defs={defs} />
            </>
          }
        />
      </CardTabToolbar>
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={defs}
          rows={filtered}
          rowKey={(projectType) => projectType.id}
          selection={selection}
          label={ui.automation.creationScope.sectionTitle}
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.automation.entry.connectedEmpty}
          onOpenRow={(projectType, rowEl) =>
            openCard({ kind: 'project-type', id: projectType.id }, rowEl.getBoundingClientRect())
          }
          rowMenu={(projectType) => [
            {
              id: 'open',
              label: ui.common.open,
              onSelect: () => openCard({ kind: 'project-type', id: projectType.id }),
            },
            {
              id: 'settings',
              label: ui.automation.menuSettingsType,
              onSelect: () => openSettings({ kind: 'project-type', id: projectType.id }),
            },
            ...(canSave
              ? [
                  {
                    id: 'disconnect',
                    label: ui.automation.entry.disconnect,
                    onSelect: () => setAllowed(projectType.id, false),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <BulkIsland
        visible={canSave && selectedRows.length > 0}
        count={selectedRows.length}
        ariaLabel={ui.automation.creationScope.sectionTitle}
        onClear={selection.clear}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            for (const item of selectedRows) setAllowed(item.id, false);
            selection.clear();
          }}
        >
          {ui.automation.entry.disconnectSelected}
        </Button>
      </BulkIsland>
      <CatalogPicker
        title={ui.automation.entry.connectProjectType}
        groups={[{ id: 'pt', label: ui.automation.entry.groups.project, items: connectable }]}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConnect={(ids) => {
          for (const id of ids) setAllowed(id, true);
        }}
      />
    </div>
  );
}
