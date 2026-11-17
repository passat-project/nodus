import { useRef } from 'react';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import type { PresenceStatus, UserCard, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';
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
import { ProfileSectionHeading } from './profile-section-heading.js';

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
 * Постоянная ЛЕВАЯ зона профиля карточки сотрудника (#750, #923): БОЛЬШАЯ
 * фотография (камера — только своя карточка) с presence-чипом под ней и
 * заголовок «Информация о сотруднике» над полями-реестром полного UserCard
 * (1↔2 колонки по ширине зоны; на узкой поля уходят под фото), ниже —
 * «Подчинённые» тем же стилем заголовка и сеткой 1↔2, переход в карточки
 * стеком (ADR-0009). Кнопки правки и действий живут в нижней полосе зоны
 * (`EmployeeProfileBar`), не здесь; скролл своей зоны, по горизонтали контент
 * не скроллится.
 */
export function EmployeeProfileTab({
  card,
  listItem,
  manager,
  subordinates,
  presenceStatus,
  canEditAvatar = false,
}: {
  card: UserCard;
  listItem: UserListItem;
  manager: UserListItem | undefined;
  subordinates: UserListItem[];
  presenceStatus: PresenceStatus;
  /** Своя карточка (#186): фото кликабельно — загрузка/смена/удаление. */
  canEditAvatar?: boolean;
}) {
  const openCard = useOpenCard();
  const setAvatar = useSetMyAvatar();
  const removeAvatar = useRemoveMyAvatar();
  const avatarInputRef = useRef<HTMLInputElement>(null);

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
    <div className="h-full overflow-x-hidden overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-0">
          {/* Фото профиля: клик — выбрать, ПКМ — сменить/убрать (канон
              контекстных меню). Кнопки правки из-под аватара убраны в нижнюю
              полосу карточки (#923). */}
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
          {/* Поля — справа от фото, когда зона широкая (flex-wrap поднимает их
              на первую строку); на узкой уходят под фото вместе с заголовком
              секции (#923). 1↔2 колонки — `@min-[55rem]` по ширине ЗОНЫ. */}
          <div className="min-w-0 flex-1 basis-[30rem]">
            <ProfileSectionHeading label={ui.employees.profileInfo} />
            <EntityFields
              defs={employeeProfileDefs({ card, listItem, manager, openCard })}
              storageKey={VISIBILITY_KEY}
            />
          </div>
        </div>
        <div className="mt-8">
          <ProfileSectionHeading label={ui.employees.subordinates} count={subordinates.length} />
        </div>
        {/* Сетка подчинённых — та же container-query логика, что у полей:
            узко 1 колонка (должность под именем), широко 2 (должность
            справа, `min-w-0` + truncate — без горизонтального скролла). */}
        <div className="mt-2.5 grid grid-cols-1 gap-x-12 gap-y-0.5 @min-[55rem]:grid-cols-2">
          {subordinates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.common.empty}</p>
          ) : null}
          {subordinates.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => openCard({ kind: 'employee', id: person.id })}
              className="flex min-w-0 flex-col gap-0.5 rounded-md px-1 py-1.5 text-left hover:bg-accent/50 @min-[30rem]:flex-row @min-[30rem]:items-center @min-[30rem]:gap-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <PersonAvatar name={person.displayName} className="size-7 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
              </span>
              <span className="min-w-0 truncate pl-9.5 text-xs text-muted-foreground @min-[30rem]:ml-auto @min-[30rem]:pl-0">
                {person.positionName ?? ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
