import { MoreHorizontal } from 'lucide-react';
import type { ConversationListItem, ConversationMember } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { cn } from '@nodus/ui/lib/utils';

import { openCardViaBridge } from '../lib/card-bridge.js';
import { withoutPatronymic } from '../lib/format.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { canManageSettings, canRemoveMembers } from './conversations.js';
import { useRemoveMember, useUpdateMemberRole } from './manage-api.js';

/**
 * Строка участника беседы (#186): аватар + имя с ролью и меню «⋯»; вынесена
 * из панели (I5). С #728 строка — переход в карточку сотрудника (стек поверх
 * мессенджера, rect — сама строка): личный диалог живёт в карточке. Своя
 * строка — пассивная (свой профиль открывается из топбара), меню действий
 * остаётся сиблингом кнопки — вложенных интерактивов нет.
 */

/** Чип роли строки участника: владелец/модератор; участник — без чипа. */
function RoleChip({ role }: { role: ConversationMember['role'] }) {
  if (role === 'owner') return <NodeChip tone="info">{ui.chat.roleChipOwner}</NodeChip>;
  if (role === 'admin') return <NodeChip tone="muted">{ui.chat.roleChipAdmin}</NodeChip>;
  return null;
}

/** Пункты меню строки участника — чистая функция (unit-тест): права матрицы
 *  + иерархия (актёр строго старше цели), своя строка — без действий. */
export function memberRowActions(params: {
  conversation: ConversationListItem;
  member: ConversationMember;
  meId: string | null | undefined;
}): { makeAdmin: boolean; demoteAdmin: boolean; remove: boolean } {
  const { conversation, member, meId } = params;
  // Чат задачи/письма: состав и роли ведёт сущность (#252) — без команд.
  if (
    member.user.id === meId ||
    member.role === 'owner' ||
    conversation.type === 'task' ||
    conversation.type === 'letter'
  ) {
    return { makeAdmin: false, demoteAdmin: false, remove: false };
  }
  const rank: Record<ConversationMember['role'], number> = { owner: 2, admin: 1, member: 0 };
  const myRank = rank[conversation.myRole];
  const targetRank = rank[member.role];
  return {
    makeAdmin: canManageSettings(conversation) && member.role === 'member',
    demoteAdmin: canManageSettings(conversation) && member.role === 'admin',
    remove: canRemoveMembers(conversation) && myRank > targetRank,
  };
}

export function MemberRow({
  conversation,
  member,
  meId,
}: {
  conversation: ConversationListItem;
  member: ConversationMember;
  meId: string | null | undefined;
}) {
  const updateRole = useUpdateMemberRole(conversation.id);
  const removeMember = useRemoveMember(conversation.id);
  const actions = memberRowActions({ conversation, member, meId });
  const hasMenu = actions.makeAdmin || actions.demoteAdmin || actions.remove;
  const self = member.user.id === meId;
  // Единая геометрия строки: пилюля-переход с полями px-2 py-2 внутри
  // строки px-2 pr-4 — высота (48px) и отступы (16px слева/справа) прежние,
  // но пилюля получила свою подложку и фокус-рамку.
  const personClass = 'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left';
  const person = (
    <>
      <PersonAvatar
        name={member.user.displayName}
        avatarUrl={member.user.avatarUrl}
        decorative
        className="size-8 shrink-0"
        // Подсказку несёт кнопка строки — второй title не нужен.
        title=""
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {withoutPatronymic(member.user.displayName)}
          {self ? (
            <span className="font-normal text-muted-foreground"> ({ui.common.you})</span>
          ) : null}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex items-center gap-2.5 px-2 pr-4">
      {self ? (
        <div data-slot="member-person" className={personClass}>
          {person}
        </div>
      ) : (
        <button
          type="button"
          data-slot="member-person"
          // Скринридер: имя человека + действие (действие — из i18n).
          aria-label={`${member.user.displayName}, ${ui.chat.openEmployeeCard}`}
          // Подсказка при наведении — имя участника, не название действия.
          title={member.user.displayName}
          onClick={(event) =>
            openCardViaBridge(
              { kind: 'employee', id: member.user.id },
              event.currentTarget.getBoundingClientRect(),
            )
          }
          className={cn(
            personClass,
            // Канон фокуса кнопок (packages/ui/.../button.tsx): тонкая рамка,
            // толстые ринги запрещены (nodus-ui-style/references/tokens.md).
            'cursor-pointer outline-none transition-colors hover:bg-accent/60',
            'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40',
          )}
        >
          {person}
        </button>
      )}
      <RoleChip role={member.role} />
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              aria-label={ui.chat.memberMenu}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {actions.makeAdmin ? (
              <DropdownMenuItem
                onClick={() => updateRole.mutate({ userId: member.user.id, role: 'admin' })}
              >
                {ui.chat.memberMakeAdmin}
              </DropdownMenuItem>
            ) : null}
            {actions.demoteAdmin ? (
              <DropdownMenuItem
                onClick={() => updateRole.mutate({ userId: member.user.id, role: 'member' })}
              >
                {ui.chat.memberDemoteAdmin}
              </DropdownMenuItem>
            ) : null}
            {actions.remove ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => removeMember.mutate(member.user.id)}
              >
                {ui.chat.memberRemove}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
