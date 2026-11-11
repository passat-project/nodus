// I5-обоснование (>300 строк): панель участников и окно добавления — две
// поверхности ОДНОГО процесса «участники беседы» (#186): общий стор-хук,
// пикер людей и права матрицы; разносить по файлам до стабилизации —
// плодить связи ради строки лимита.
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ConversationListItem, ConversationMember, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Input } from '@nodus/ui/components/input';
import { NodeChip } from '@nodus/ui/components/node-chip';

import { api } from '../api-client.js';
import { usersKeys } from '../api/users-list.js';
import { useAuthStore } from '../auth-store.js';
import { withoutPatronymic } from '../lib/format.js';
import type { Paginated } from '@nodus/contracts';
import { PersonAvatar } from '../ui/person-avatar.js';
import { canAddMembers, canManageSettings, canRemoveMembers } from './conversations.js';
import {
  useAddMembers,
  useConversationMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from './manage-api.js';

/**
 * Панель участников беседы (#186): список с ролями (владелец/модератор),
 * поиск, «Добавить», меню строки «⋯» (назначить/снять модератора, удалить —
 * по правам матрицы). Рендерится в колонке панели беседы (та же геометрия
 * 1:1, view-переключение в chat-side-panel).
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

function MemberRow({
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

  return (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <PersonAvatar
        name={member.user.displayName}
        avatarUrl={member.user.avatarUrl}
        decorative
        className="size-8 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {withoutPatronymic(member.user.displayName)}
          {member.user.id === meId ? (
            <span className="font-normal text-muted-foreground"> ({ui.common.you})</span>
          ) : null}
        </div>
      </div>
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

/** Контент панели участников (заголовок/закрытие — у колонки chat-side-panel). */
export function ConversationMembersPanel({
  conversation,
  onAddMembers,
}: {
  conversation: ConversationListItem;
  onAddMembers: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useConversationMembers(conversation.id, debounced);
  const members = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ui.chat.membersSearchPlaceholder}
            aria-label={ui.chat.membersSearchPlaceholder}
            className="h-8 pl-8 text-sm"
          />
        </div>
        {canAddMembers(conversation) ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2.5"
            onClick={onAddMembers}
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            {ui.common.add}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {members.length > 0 ? (
          members.map((member) => (
            <MemberRow
              key={member.user.id}
              conversation={conversation}
              member={member}
              meId={meId}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {ui.chat.membersEmpty}
          </p>
        )}
        {query.hasNextPage ? (
          <div className="px-4 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {ui.common.showAll}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Окно добавления участников: серверный поиск справочника + мультивыбор
 *  чипами (модель окна создания чата); уже состоящие отфильтрованы (список
 *  участников читает тот же кэш, что панель). */
export function AddMembersDialog({
  conversation,
  onClose,
}: {
  conversation: ConversationListItem;
  onClose: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<UserListItem[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data } = useQuery({
    queryKey: usersKeys.search('add-members', debounced),
    queryFn: () => {
      const params = new URLSearchParams({ limit: '50' });
      if (debounced) params.set('search', debounced);
      return api<Paginated<UserListItem>>(`/directory/users?${params}`);
    },
  });
  const members = useConversationMembers(conversation.id);

  const existing = useMemo(
    () => new Set((members.data?.pages[0]?.items ?? []).map((m) => m.user.id)),
    [members.data],
  );
  const candidates = useMemo(
    () =>
      (data?.items ?? []).filter(
        (u: UserListItem) =>
          u.id !== meId && !existing.has(u.id) && !picked.some((p) => p.id === u.id),
      ),
    [data, existing, picked, meId],
  );

  const add = useAddMembers(conversation.id);
  function submit() {
    if (picked.length === 0) return;
    add.mutate(
      picked.map((p) => p.id),
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ui.chat.membersAddMore}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ui.chat.participantSearch}
              aria-label={ui.chat.participantSearch}
              className="h-9 pl-8 text-sm"
              autoFocus
            />
          </div>
          {picked.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((person) => (
                <span
                  key={person.id}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-1 text-xs font-medium"
                >
                  <PersonAvatar
                    name={person.displayName}
                    avatarUrl={person.avatarUrl}
                    decorative
                    className="size-4"
                  />
                  {withoutPatronymic(person.displayName)}
                  <button
                    type="button"
                    onClick={() => setPicked(picked.filter((p) => p.id !== person.id))}
                    aria-label={ui.chat.removeParticipant}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {/* Зона списка — фиксированной высоты (канон пикеров: окно не прыгает). */}
          <div className="flex h-64 flex-col overflow-y-auto rounded-lg border border-border p-1">
            {candidates.map((person: UserListItem) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setPicked([...picked, person])}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <PersonAvatar
                  name={person.displayName}
                  avatarUrl={person.avatarUrl}
                  decorative
                  className="size-6"
                />
                <span className="truncate">{withoutPatronymic(person.displayName)}</span>
              </button>
            ))}
            {candidates.length === 0 ? (
              <span className="px-2 py-3 text-center text-xs text-muted-foreground">
                {ui.chat.forwardEmpty}
              </span>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button
            variant="secondary"
            disabled={picked.length === 0 || add.isPending}
            onClick={submit}
          >
            {ui.common.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
