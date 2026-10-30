import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import type { PresenceStatus, UserCard, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { avatarIssueMessage, validateAvatarFile } from '../../../shared/chat/avatar-upload.js';
import { EntityFields } from '../../../shared/ui/entity-fields.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useRemoveMyAvatar, useSetMyAvatar } from '../api/directory-api.js';
import { employeeProfileDefs } from '../lib/employee-profile-fields.js';
import { EmployeeEditDialog } from './employee-edit-dialog.js';

const VISIBILITY_KEY = 'nodus-employee-fields-v1';

const presenceTone: Record<PresenceStatus, 'success' | 'warning' | 'muted'> = {
  online: 'success',
  away: 'warning',
  offline: 'muted',
};

function presenceLabel(status: PresenceStatus): string {
  if (status === 'online') return ui.common.online;
  if (status === 'away') return ui.common.away;
  return ui.common.offline;
}

/**
 * Вкладка «Профиль» карточки сотрудника (вердикт владельца 15.09.2026,
 * модель профиля Битрикс24): БОЛЬШАЯ фотография (не аватарка в баре —
 * общего бара с дублирующей инфой больше нет, полезная высота — данным) с
 * presence-чипом под ней; правее — поля-реестр полного UserCard (на узкой
 * зоне поля уходят под фото); ниже — «Подчинённые» (переход в их карточки
 * стеком, ADR-0009).
 */
export function EmployeeProfileTab({
  card,
  listItem,
  manager,
  subordinates,
  presenceStatus,
  users,
  canEditAvatar = false,
  canManage = false,
}: {
  card: UserCard;
  listItem: UserListItem;
  manager: UserListItem | undefined;
  subordinates: UserListItem[];
  presenceStatus: PresenceStatus;
  /** Полный список сотрудников — для выбора руководителя (#441). */
  users: UserListItem[];
  /** Своя карточка (#186): фото кликабельно — загрузка/смена/удаление. */
  canEditAvatar?: boolean;
  /** Право `directory.manage` (#441): правка подразделения/должности/руководителя. */
  canManage?: boolean;
}) {
  const openCard = useOpenCard();
  const setAvatar = useSetMyAvatar();
  const removeAvatar = useRemoveMyAvatar();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [editOpen, setEditOpen] = useState(false);

  function onAvatarPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const issue = validateAvatarFile(file);
    if (issue) {
      toast.error(avatarIssueMessage(issue));
      return;
    }
    setAvatar.mutate(file);
  }

  const photo = (
    <PersonAvatar
      name={card.displayName}
      avatarUrl={card.avatarUrl}
      className="size-44"
      fallbackClass="text-4xl"
    />
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start gap-8">
          {/* Большое фото профиля (реф — карточка фото в профиле Битрикс24):
              Ø176, инициалы крупно, когда фото нет; presence — чипом под
              фото (точка + подпись). СВОЯ карточка (#186): клик — выбрать
              фото, ПКМ — сменить/убрать (канон контекстных меню). */}
          <div className="flex shrink-0 flex-col items-center gap-2.5">
            {canEditAvatar ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    aria-label={card.avatarUrl ? ui.common.avatarChange : ui.common.avatarUpload}
                    title={card.avatarUrl ? ui.common.avatarChange : ui.common.avatarUpload}
                    className="group relative size-44 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-port"
                  >
                    {photo}
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Camera className="size-7" strokeWidth={1.75} aria-hidden />
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => avatarInputRef.current?.click()}>
                    {card.avatarUrl ? ui.common.avatarChange : ui.common.avatarUpload}
                  </ContextMenuItem>
                  {card.avatarUrl ? (
                    <ContextMenuItem variant="destructive" onClick={() => removeAvatar.mutate()}>
                      {ui.common.avatarRemove}
                    </ContextMenuItem>
                  ) : null}
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              photo
            )}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onAvatarPicked}
              aria-hidden
              tabIndex={-1}
            />
            <NodeChip tone={presenceTone[presenceStatus]}>
              <span
                aria-hidden
                className={
                  presenceStatus === 'online'
                    ? 'size-1.5 rounded-full bg-success'
                    : presenceStatus === 'away'
                      ? 'size-1.5 rounded-full bg-warning'
                      : 'size-1.5 rounded-full bg-muted-foreground'
                }
              />
              {presenceLabel(presenceStatus)}
            </NodeChip>
          </div>
          <div className="min-w-0 flex-1 basis-[30rem]">
            {canManage ? (
              <div className="mb-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  {ui.employees.editEmployee}
                </Button>
              </div>
            ) : null}
            <EntityFields
              defs={employeeProfileDefs({ card, listItem, manager, openCard })}
              storageKey={VISIBILITY_KEY}
            />
          </div>
        </div>
        <div className="mt-8">
          <NodeLabel label={ui.employees.subordinates} count={subordinates.length} />
        </div>
        <div className="mt-2.5 flex flex-col gap-1">
          {subordinates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.common.empty}</p>
          ) : null}
          {subordinates.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => openCard({ kind: 'employee', id: person.id })}
              className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-left text-sm hover:bg-accent/50"
            >
              <PersonAvatar name={person.displayName} className="size-7 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {person.positionName ?? ''}
              </span>
            </button>
          ))}
        </div>
      </div>
      {canManage ? (
        <EmployeeEditDialog open={editOpen} onOpenChange={setEditOpen} card={card} users={users} />
      ) : null}
    </div>
  );
}
