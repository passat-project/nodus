import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { Position, UserListItem } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';

import { ApiError } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { usePositions } from '../../../shared/api/positions.js';
import { RowMenu, type RowMenuItem } from '../../../shared/views/row-menu.js';
import {
  useCreatePosition,
  useDeletePosition,
  useReassignPosition,
  useUpdatePosition,
} from '../api/directory-api.js';
import { PositionCreateDialog, normalizePositionName } from './position-create-dialog.js';
import { ReassignPositionDialog } from './position-delete-dialogs.js';
import { StructurePanelHeader } from './structure-panel-header.js';
import { StructureSidePanel } from './structure-side-panel.js';

/**
 * Правая панель «Должности» (#768, вердикты владельца 12–13.11.2026): только
 * управленческие должности; читают все, создание/переименование/
 * переназначение/удаление — администраторы (`directory.manage`). Панель
 * подменяет содержимое панели подразделения (иконка «Список должностей» в
 * шапке) и закрывается крестиком — возвращает сотрудников подразделения.
 * Шапка панели — общая строка h-14 (`StructurePanelHeader`), на одной
 * горизонтали с шапкой страницы. Сверху поиск
 * по названию; ввод новой должности — в диалоге кнопки «Добавить» с проверкой
 * дублей (без учёта регистра) и ошибкой в самом диалоге, а не системным тостом.
 * В строке «шашка» меню (как в журналах) перед названием и число СОТРУДНИКОВ
 * на должности (0 видно; уволенные тоже считаются — отдельного архива
 * должностей у них нет). Удаление: без сотрудников — сразу; с сотрудниками —
 * сначала «Перевести сотрудников» на другую активную управленческую
 * должность. Должность больше не используется в маршрутах (#806).
 */
export function PositionsPanel({
  users,
  topShift,
  canManage,
  onClose,
}: {
  users: readonly UserListItem[];
  topShift: number;
  canManage: boolean;
  /** Крестик — вернуться к панели сотрудников подразделения. */
  onClose: () => void;
}) {
  const positionsData = usePositions('management').data;
  const positions = useMemo(() => positionsData ?? [], [positionsData]);
  const create = useCreatePosition('management');
  const update = useUpdatePosition('management');
  const remove = useDeletePosition('management');
  const reassign = useReassignPosition('management');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [reassignFor, setReassignFor] = useState<Position | null>(null);

  // Сотрудники на должности — все статусы: уволенные тоже переназначаются.
  const holdersOf = (id: string) => users.filter((user) => user.positionId === id).length;
  const pending = create.isPending || update.isPending || remove.isPending || reassign.isPending;
  const targets = reassignFor
    ? positions.filter((position) => position.id !== reassignFor.id && position.isActive)
    : [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return needle
      ? positions.filter((position) => position.name.toLocaleLowerCase('ru').includes(needle))
      : positions;
  }, [positions, query]);
  const existingNames = useMemo(
    () => positions.map((position) => normalizePositionName(position.name)),
    [positions],
  );

  function saveRename(id: string) {
    const name = editingName.trim();
    if (!name || pending) return;
    update.mutate(
      { id, patch: { name } },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditingName('');
        },
      },
    );
  }

  function requestDelete(position: Position) {
    if (pending) return;
    if (holdersOf(position.id) > 0) {
      setReassignFor(position);
      return;
    }
    remove.mutate(position.id, {
      onError: (error) => {
        if (error instanceof ApiError && error.code === ErrorCode.DIRECTORY_POSITION_IN_USE) {
          // Сотрудник появился после отрисовки — открываем переназначение
          // со свежим числом от сервера.
          setReassignFor(position);
          return;
        }
        toastApiError(error);
      },
    });
  }

  function submitReassign(targetId: string) {
    if (!reassignFor || pending) return;
    reassign.mutate({ id: reassignFor.id, targetId }, { onSuccess: () => setReassignFor(null) });
  }

  function rowMenu(position: Position): RowMenuItem[] {
    return [
      {
        id: 'rename',
        icon: <Pencil className="size-3.5" />,
        label: ui.employees.renamePosition,
        onSelect: () => {
          setEditingId(position.id);
          setEditingName(position.name);
        },
      },
      {
        id: 'delete',
        icon: <Trash2 className="size-3.5" />,
        label: ui.employees.positionDelete,
        danger: true,
        separatorBefore: true,
        onSelect: () => requestDelete(position),
      },
    ];
  }

  return (
    <StructureSidePanel
      topShift={topShift}
      header={
        <StructurePanelHeader
          title={ui.employees.positionsList}
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={ui.common.close}
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          }
        />
      }
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui.employees.positionSearch}
            aria-label={ui.employees.positionSearch}
            className="h-8 pl-7 text-sm"
          />
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setCreateOpen(true)}
          >
            <Plus data-icon="inline-start" />
            {ui.employees.positionAdd}
          </Button>
        )}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {positions.length === 0 ? (
          <li className="flex h-24 items-center justify-center px-3 text-sm text-muted-foreground">
            {ui.employees.noPositions}
          </li>
        ) : null}
        {positions.length > 0 && filtered.length === 0 ? (
          <li className="flex h-24 items-center justify-center px-3 text-sm text-muted-foreground">
            {ui.filters.notFound}
          </li>
        ) : null}
        {filtered.map((position) => (
          <li
            key={position.id}
            className="flex items-center gap-1 rounded-lg px-1 py-1.5 transition-colors hover:bg-accent/30"
          >
            {editingId === position.id ? (
              <>
                <Input
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="h-7 flex-1 text-sm"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveRename(position.id);
                    if (event.key === 'Escape') {
                      // Esc отменяет переименование, а не закрывает панель.
                      event.stopPropagation();
                      setEditingId(null);
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={ui.common.save}
                  title={ui.common.save}
                  disabled={pending}
                  onClick={() => saveRename(position.id)}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={ui.common.cancel}
                  title={ui.common.cancel}
                  onClick={() => setEditingId(null)}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : (
              <>
                {/* «Шашка» меню — как в журналах (три горизонтальные линии):
                    ПЕРЕД названием, действия не загромождают строку. */}
                {canManage ? <RowMenu items={rowMenu(position)} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{position.name}</span>
                  <span className="block font-mono text-label-sm text-muted-foreground tabular-nums">
                    {ui.employees.positionHolders}: {holdersOf(position.id)}
                  </span>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <PositionCreateDialog
        open={createOpen}
        existingNames={existingNames}
        onOpenChange={setCreateOpen}
        onSubmit={async (name) => {
          await create.mutateAsync({ name, kind: 'management', sortOrder: 0 });
        }}
      />
      <ReassignPositionDialog
        position={reassignFor}
        holders={reassignFor ? holdersOf(reassignFor.id) : 0}
        targets={targets}
        pending={reassign.isPending}
        onClose={() => setReassignFor(null)}
        onSubmit={submitReassign}
      />
    </StructureSidePanel>
  );
}
