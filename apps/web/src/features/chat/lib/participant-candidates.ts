import type { UserListItem } from '@nodus/contracts';

/**
 * Кандидаты в участники нового группового чата/канала (#1013): только
 * действующие сотрудники — как в поиске людей мессенджера (#343). Уволенный
 * не должен предлагаться: сервер его всё равно отфильтрует
 * (`ConversationMembersService.add` → `filterActiveUserIds`), и выбор
 * «добавил, а в чате нет» вводит в заблуждение.
 */
export function chatParticipantCandidates(
  users: readonly UserListItem[],
  opts: { meId?: string | null; selectedIds: readonly string[]; query: string },
): UserListItem[] {
  const query = opts.query.trim().toLowerCase();
  const selected = new Set(opts.selectedIds);
  return users.filter(
    (user) =>
      user.status === 'active' &&
      user.id !== opts.meId &&
      !selected.has(user.id) &&
      (!query || user.displayName.toLowerCase().includes(query)),
  );
}
