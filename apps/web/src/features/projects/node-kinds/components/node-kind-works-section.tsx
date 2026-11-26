import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NodeKind, ProcessType } from '@nodus/contracts';
import { typeConfigOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Switch } from '@nodus/ui/components/switch';
import { Link2, Plus, Unlink } from 'lucide-react';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { cn } from '@nodus/ui/lib/utils';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../../shared/workflow/type-tone.js';
import type { FilterFieldDef } from '../../../../shared/views/list-filters.js';
import { ListToolbar } from '../../../../shared/views/list-toolbar.js';
import { CardTabToolbar } from '../../../../shared/ui/entity-card/card-tab-toolbar.js';
import { BulkIsland, bulkActionClass } from '../../../../shared/views/bulk-island.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';

/** Ключ вида: колонки и ширины общие у всех типов папок (#857). */
const VIEW_KEY = 'processes.kind-works';

/**
 * Раздел «Работы в папке» карточки типа папки (#857, единая модель §11) —
 * СПИСОК в грамматике журналов портала (вердикт владельца 26.11.2026):
 * типы задач, привязанные к этому типу папки (`creation.folderKindId`, #665 —
 * вторая сторона «Где создаётся»). Строка: значок+название, описание,
 * тумблер привязки в ячейке действий. Запись требует `workflow.manage`; без
 * права — только просмотр с пояснением (сервер — истина, I8).
 */
export function NodeKindWorksSection({
  kind,
  canManage,
  onOpenType,
  renderProcessTypeCreate,
}: {
  kind: NodeKind;
  canManage: boolean;
  /** Клик по строке — настройка маршрута этого типа (та же рама справа). */
  onOpenType: (id: string) => void;
  /** Окно создания типа задачи (слот фичи automation, I6): создан — сразу
   *  привязан к этой папке (`creation.folderKindId`). */
  renderProcessTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}) {
  const tasks = useLiveProcessTypes('task');
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  const all = useMemo(() => tasks.data ?? [], [tasks.data]);
  const [createOpen, setCreateOpen] = useState(false);
  // Созданный тип дожидаемся в живых данных: привязка сохраняет и остальную
  // настройку основы-копии (без перезаписи умолчаниями).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = pendingId ? all.find((type) => type.id === pendingId) : undefined;
  useEffect(() => {
    if (!pending) return;
    const scope = typeConfigOf(pending).creation;
    update.mutate({ typeId: pending.id, creation: { ...scope, folderKindId: kind.id } });
    setPendingId(null);
  }, [pending, kind.id, update]);

  const q = toolbar.query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (type) =>
          !q ||
          type.name.toLowerCase().includes(q) ||
          (type.description ?? '').toLowerCase().includes(q),
      ),
    [all, q],
  );

  const rowKeys = useMemo(() => rows.map((type) => type.id), [rows]);
  const selection = useRowSelection(rowKeys);
  const selectedRows = useMemo(
    () => rows.filter((type) => selection.selected.has(type.id)),
    [rows, selection.selected],
  );

  /** Пакетная привязка/отвязка: `folderKindId` — одна папка на тип работы. */
  function setBound(items: readonly ProcessType[], bound: boolean) {
    for (const type of items) {
      const scope = typeConfigOf(type).creation;
      update.mutate({
        typeId: type.id,
        creation: { ...scope, folderKindId: bound ? kind.id : null },
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
        defaultWidth: 300,
        minWidth: 160,
        maxWidth: 320,
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

  if (all.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <Empty>
          <EmptyTitle>{ui.nodeKinds.screen.worksEmpty}</EmptyTitle>
        </Empty>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProcessType>[]}
          left={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.createTaskType}
              </Button>
            ) : undefined
          }
          right={<ViewSettings viewKey={VIEW_KEY} defs={defs} />}
        />
      </CardTabToolbar>
      {!canManage ? (
        <div className="px-6 pb-2">
          <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={defs}
          rows={rows}
          rowKey={(type) => type.id}
          selection={selection}
          label={ui.nodeKinds.screen.works}
          emptyTitle={q ? ui.automation.entry.searchEmpty : ui.nodeKinds.screen.worksEmpty}
          onOpenRow={(type) => onOpenType(type.id)}
          rowMenu={(type) => [
            { id: 'open', label: ui.common.open, onSelect: () => onOpenType(type.id) },
          ]}
          actions={(type) => {
            const scope = typeConfigOf(type).creation;
            return (
              <Switch
                checked={scope.folderKindId === kind.id}
                disabled={!canManage || update.isPending}
                aria-label={`${type.name}: ${ui.nodeKinds.screen.worksBound}`}
                onCheckedChange={(checked) =>
                  update.mutate({
                    typeId: type.id,
                    creation: { ...scope, folderKindId: checked ? kind.id : null },
                  })
                }
              />
            );
          }}
        />
        <BulkIsland
          visible={canManage && selectedRows.length > 0}
          count={selectedRows.length}
          ariaLabel={ui.nodeKinds.screen.works}
          onClear={selection.clear}
        >
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={canManage && selectedRows.length > 0 ? 0 : -1}
            onClick={() => setBound(selectedRows, true)}
          >
            <Link2 className="size-4" strokeWidth={1.75} />
            {ui.nodeKinds.screen.worksBind}
          </button>
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={canManage && selectedRows.length > 0 ? 0 : -1}
            onClick={() => setBound(selectedRows, false)}
          >
            <Unlink className="size-4" strokeWidth={1.75} />
            {ui.nodeKinds.screen.worksUnbind}
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
