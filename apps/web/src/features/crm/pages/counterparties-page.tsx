import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CounterpartyListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Checkbox } from '@nodus/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useDebouncedValue } from '../../../shared/lib/use-debounced-value.js';
import { useCounterpartiesPages } from '../../../shared/counterparties/queries.js';
import {
  useCanCreateCounterparties,
  useCanManageCounterparties,
} from '../../../shared/counterparties/use-crm-permissions.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useDeleteCounterparty, useSetCounterpartyArchived } from '../api/counterparty-edit.js';
import { CounterpartyBulkIsland } from '../components/counterparty-bulk-island.js';
import {
  CounterpartyFormDialog,
  type CounterpartyEditTarget,
} from '../components/counterparty-form-dialog.js';
import { counterpartyFields } from '../lib/counterparty-fields.js';
import { counterpartyRowMenu } from '../lib/counterparty-row-menu.js';

/**
 * Контрагенты — вкладка раздела CRM (#83): справочник внешних организаций
 * (заказчики, подрядчики, поставщики, госорганы) на живом API модуля crm
 * (#460). Реестр — каноническая таблица shared/views (ключ
 * `counterparties.list`): бесконечная прокрутка по курсору, СЕРВЕРНЫЙ поиск
 * (название, полное название, УНП) с задержкой 250 мс, переключатель
 * «Показывать архивные»; счётчик в заголовке — N, при недогруженных
 * страницах N+ (истинное число строк сервер не отдаёт — totals нет).
 * Выделение строк ведёт ОБЩИЙ островок массовых действий (архив/возврат
 * пачкой, до 100). «Создать» — только с правом `crm.create` (I8).
 */
export function CounterpartiesPage() {
  const toolbar = useListToolbar('counterparties.list');
  const search = useDebouncedValue(toolbar.query.trim(), 250);
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useCounterpartiesPages({ search: search || undefined, includeArchived });
  const openCard = useOpenCard();
  const canCreate = useCanCreateCounterparties();
  const canManage = useCanManageCounterparties();
  const [createOpen, setCreateOpen] = useState(false);
  // Действия строки: правка — окно формы, архив/возврат — сразу (обратимо),
  // удаление — с подтверждением (необратимо, канон диалогов).
  const [editTarget, setEditTarget] = useState<CounterpartyEditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CounterpartyListItem | null>(null);
  const setArchived = useSetCounterpartyArchived();
  const remove = useDeleteCounterparty();

  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const rowKeys = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useRowSelection(rowKeys);
  // Действия островка зависят от состава выделения (вердикт владельца
  // 25.10.2026): «Из архива» не висит, когда архивных среди выбранных нет.
  const selectedRows = useMemo(
    () => rows.filter((row) => selection.selected.has(row.id)),
    [rows, selection.selected],
  );
  const hasActive = selectedRows.some((row) => row.archivedAt === null);
  const hasArchived = selectedRows.some((row) => row.archivedAt !== null);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="flex shrink-0 items-baseline gap-2 text-xl font-semibold text-balance text-foreground">
          {ui.counterparties.title}
          <span className="inline-block min-w-8 font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
            {rows.length}
            {hasNextPage ? '+' : ''}
          </span>
        </h1>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[]}
          searchPlaceholder={ui.counterparties.searchPlaceholder}
          left={
            canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.common.create}
              </Button>
            ) : undefined
          }
          right={
            <>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                <Checkbox
                  checked={includeArchived}
                  onCheckedChange={(checked) => setIncludeArchived(checked === true)}
                  aria-label={ui.counterparties.showArchived}
                />
                {ui.counterparties.showArchived}
              </label>
              <ViewSettings viewKey="counterparties.list" defs={counterpartyFields} />
            </>
          }
        />
      </div>
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey="counterparties.list"
          defs={counterpartyFields}
          rows={rows}
          rowKey={(c) => c.id}
          selection={selection}
          isLoading={isLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          onOpenRow={(c, rowEl) =>
            openCard({ kind: 'counterparty', id: c.id }, rowEl.getBoundingClientRect())
          }
          emptyTitle={search ? ui.counterparties.emptySearch : ui.counterparties.empty}
          rowMenu={(c) =>
            counterpartyRowMenu({
              row: c,
              openCard,
              canManage,
              onEdit: (row) => setEditTarget(row),
              onArchive: (row, archived) => setArchived.mutate({ id: row.id, archived }),
              onDelete: (row) => setDeleteTarget(row),
            })
          }
        />
      </div>
      <CounterpartyBulkIsland
        selectedIds={selectedRows.map((row) => row.id)}
        hasActive={hasActive}
        hasArchived={hasArchived}
        visible={selectedRows.length > 0}
        onClear={selection.clear}
      />
      <CounterpartyFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      {/* Окно правки монтируется только при выбранной строке: иначе на
          анимации закрытия оно перерисовывалось в режим «Создать» (другой
          заголовок, панель «Похожие», выше) — мигание за окном (баг 25.10.2026). */}
      {editTarget ? (
        <CounterpartyFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          target={editTarget}
        />
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ui.counterparties.deleteConfirmTitle}</DialogTitle>
            <DialogDescription>{ui.counterparties.deleteConfirmText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(deleteTarget?.id ?? '', {
                  onSuccess: () => {
                    // Снять выбор с удалённой строки (deselect, не toggle:
                    // toggle на неудалённом ключе ДОБАВЛЯЕТ его в выбор).
                    if (deleteTarget) selection.deselect(deleteTarget.id);
                    setDeleteTarget(null);
                  },
                })
              }
            >
              {ui.counterparties.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
