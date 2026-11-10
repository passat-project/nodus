import type { ProjectHistoryEntry, ProjectHistoryMember } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/**
 * Заголовок строки вкладки «История» (#699): создание, статус, поля и
 * семантика состава. Состав читается действием и человеком — «Снят участник:
 * Иванов», «Наблюдатель → участник: Петров»; значения «было → стало» в ленту
 * не попадают (решение владельца 10.11.2026) — строки остаются компактными.
 */
export function projectHistoryTitle(
  entry: ProjectHistoryEntry,
  fieldLabel: (field: string) => string,
): string {
  switch (entry.kind) {
    case 'created':
      return entry.name
        ? `${ui.projects.history.created}: ${entry.name}`
        : ui.projects.history.created;
    case 'status_changed':
      return entry.status
        ? `${ui.projects.history.statusChanged}: ${ui.projects.status[entry.status]}`
        : ui.projects.history.statusChanged;
    case 'participants_changed':
      return participantsTitle(entry);
    case 'updated':
      return entry.fields.length > 0
        ? `${ui.projects.history.updated}: ${entry.fields.map(fieldLabel).join(', ')}`
        : ui.projects.history.updated;
  }
}

function participantsTitle(entry: ProjectHistoryEntry): string {
  if (entry.reason === 'visibility') {
    const count = entry.members.length > 0 ? entry.members.length : entry.users.length;
    const template =
      entry.visibility === 'secret'
        ? ui.projects.history.rosterClearedSecret
        : ui.projects.history.rosterClearedOpen;
    return template.replace('{count}', String(count));
  }
  const names = entry.members.map((member) => member.user.displayName);
  if (entry.reason === 'join') {
    return names.length > 0
      ? `${ui.projects.history.joined}: ${names.join(', ')}`
      : ui.projects.history.joined;
  }
  if (entry.reason === 'leave') {
    return names.length > 0
      ? `${ui.projects.history.left}: ${names.join(', ')}`
      : ui.projects.history.left;
  }
  // Ручные действия: группа по формулировке («Снят участник: A, B»). Старые
  // записи без семантики рендерятся прежней сводкой по людям.
  const groups = new Map<string, string[]>();
  for (const member of entry.members) {
    const phrase = changePhrase(member);
    const list = groups.get(phrase) ?? [];
    list.push(member.user.displayName);
    groups.set(phrase, list);
  }
  if (groups.size > 0) {
    return [...groups].map(([phrase, people]) => `${phrase}: ${people.join(', ')}`).join('; ');
  }
  return entry.users.length > 0
    ? `${ui.projects.history.participantsChanged}: ${entry.users
        .map((user) => user.displayName)
        .join(', ')}`
    : ui.projects.history.participantsChanged;
}

function changePhrase(change: ProjectHistoryMember): string {
  if (change.action === 'role_changed') {
    if (change.to === 'observer') return ui.projects.history.roleToObserver;
    if (change.to === 'member') return ui.projects.history.roleToMember;
    return ui.projects.history.participantsChanged;
  }
  if (change.action === 'added') {
    if (change.to === 'observer') return ui.projects.history.observerAdded;
    if (change.to === 'member') return ui.projects.history.memberAdded;
    return ui.projects.history.participantsChanged;
  }
  if (change.from === 'observer') return ui.projects.history.observerRemoved;
  if (change.from === 'member') return ui.projects.history.memberRemoved;
  return ui.projects.history.participantsChanged;
}
