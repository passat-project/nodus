import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { typeConfigOf, ui, withProjectTypeAllowed } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Button } from '@nodus/ui/components/button';
import { Switch } from '@nodus/ui/components/switch';
import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { BulkIsland, bulkActionClass } from '../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { CardTabToolbar } from '../../../shared/ui/entity-card/card-tab-toolbar.js';
import { PanelNote } from '../../../shared/ui/panel/panel-kit.js';
import { DataTable, type DataTableField } from '../../../shared/views/data-table.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { FilterFieldDef } from '../../../shared/views/list-filters.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../shared/workflow/type-tone.js';

/** Ключ вида: колонки и ширины общие для всех типов проектов (#857). */
const VIEW_KEY = 'processes.type-creation';

/**
 * Вкладка «Что здесь можно создавать» (#665, ADR-0041 п.9) — СПИСОК в
 * грамматике журналов портала (вердикт владельца 26.11.2026): общий
 * `ListToolbar` (поиск стандарта журналов) и таблица `shared/views` на всю
 * ширину вкладки. Строка: значок+название, категория, описание, тумблер
 * разрешённости в ячейке действий. Тумблер снимает тип в этом типе проекта;
 * пишется в настройку САМОГО типа — вторая сторона («Где создаётся»)
 * показывает то же самое. Клик по строке открывает настройку типа справа.
 */
export function ProjectTypeCreationTab({
  type,
  canSetup,
  onOpenType,
  renderProcessTypeCreate,
}: {
  type: ProjectType;
  canSetup: boolean;
  onOpenType: (id: string) => void;
  /** Окно создания типа задачи (слот фичи automation, I6): создан — сразу
   *  разрешён в этом типе проекта. */
  renderProcessTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}) {
  const tasks = useLiveProcessTypes('task');
  const letters = useLiveProcessTypes('letter');
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  // Запись связи требует `workflow.manage` (сервер — истина, I8): у настройщика
  // типов проектов без права процессов тумблеры неактивны, а не дают 403.
  const canManage = useCanManageWorkflows();
  const canSave = canSetup && canManage;
  const [createOpen, setCreateOpen] = useState(false);
  // Созданный тип ещё не в списке на момент колбэка: дожидаемся его в живых
  // данных и снимаем исключение этого типа проекта (связка «сразу»).
  const [pendingId, setPendingId] = useState<string | null>(null);

  function toggle(item: ProcessType, allowed: boolean): void {
    const scope = typeConfigOf(item).creation;
    // Снятие работы, привязанной к включённому типу папки, — предупреждение:
    // её нельзя будет создать даже в папке (issue #665).
    const boundHere =
      !allowed &&
      scope.folderKindId !== null &&
      (type.kindIds === null || type.kindIds.includes(scope.folderKindId));
    if (boundHere) toast.warning(ui.automation.creationScope.unbindWarning);
    update.mutate({ typeId: item.id, creation: withProjectTypeAllowed(scope, type.id, allowed) });
  }

  const rows = useMemo(
    () => [...(tasks.data ?? []), ...(letters.data ?? [])],
    [tasks.data, letters.data],
  );
  const pending = pendingId ? rows.find((item) => item.id === pendingId) : undefined;
  useEffect(() => {
    if (!pending) return;
    const scope = typeConfigOf(pending).creation;
    update.mutate({
      typeId: pending.id,
      creation: withProjectTypeAllowed(scope, type.id, true),
    });
    setPendingId(null);
  }, [pending, type.id, update]);
  const q = toolbar.query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          (item.description ?? '').toLowerCase().includes(q),
      ),
    [rows, q],
  );

  const rowKeys = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useRowSelection(rowKeys);
  const selectedRows = useMemo(
    () => filtered.filter((item) => selection.selected.has(item.id)),
    [filtered, selection.selected],
  );

  /** Пакетная правка: разрешить или запретить выбранные типы в этом типе проекта. */
  function setAllowed(items: readonly ProcessType[], allowed: boolean) {
    for (const item of items) {
      update.mutate({
        typeId: item.id,
        creation: withProjectTypeAllowed(typeConfigOf(item).creation, type.id, allowed),
      });
    }
  }

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
            <NodeChip tone="muted" className="shrink-0">
              {item.category === 'task'
                ? ui.automation.entry.categoryTask
                : ui.automation.entry.categoryLetter}
            </NodeChip>
            {item.isSystem ? (
              <NodeChip tone="muted" className="shrink-0">
                {ui.automation.badgeSystem}
              </NodeChip>
            ) : null}
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
    <div className="relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProcessType>[]}
          left={
            canSave ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.createTaskType}
              </Button>
            ) : undefined
          }
          right={<ViewSettings viewKey={VIEW_KEY} defs={defs} />}
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
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.automation.creationScope.empty}
          onOpenRow={(item) => onOpenType(item.id)}
          rowMenu={(item) => [
            { id: 'open', label: ui.common.open, onSelect: () => onOpenType(item.id) },
          ]}
          actions={(item) => (
            <Switch
              checked={!typeConfigOf(item).creation.excludedProjectTypeIds.includes(type.id)}
              disabled={!canSave || update.isPending}
              aria-label={`${item.name}: ${ui.automation.creationScope.projectSectionTitle}`}
              onCheckedChange={(checked) => toggle(item, checked)}
            />
          )}
        />
        <BulkIsland
          visible={canSave && selectedRows.length > 0}
          count={selectedRows.length}
          ariaLabel={ui.projects.schemasCreationPage}
          onClear={selection.clear}
        >
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={canSave && selectedRows.length > 0 ? 0 : -1}
            onClick={() => setAllowed(selectedRows, true)}
          >
            <Check className="size-4" strokeWidth={1.75} />
            {ui.projects.schemasCreationAllow}
          </button>
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={canSave && selectedRows.length > 0 ? 0 : -1}
            onClick={() => setAllowed(selectedRows, false)}
          >
            <Minus className="size-4" strokeWidth={1.75} />
            {ui.projects.schemasCreationDeny}
          </button>
        </BulkIsland>
      </div>
      {createOpen && renderProcessTypeCreate
        ? renderProcessTypeCreate({
            onClose: () => setCreateOpen(false),
            onCreated: (id) => setPendingId(id),
          })
        : null}
    </div>
  );
}
