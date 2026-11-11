import type { ConversationListItem, UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { plural, withoutPatronymic } from '../lib/format.js';

/**
 * Заголовки/сортировка бесед — shared-слой (#87: диалог пересылки в
 * shared/chat нуждается в тех же хелперах; features/chat/lib/conversations.ts
 * реэкспортирует отсюда, потребители не меняются).
 */

/** Диалог с самим собой — «Избранное» (модель Битрикс24, вердикт владельца
 *  13.09.2026): единственный участник = текущий пользователь. */
export function isNotesConversation(
  conversation: ConversationListItem,
  meId: string | null | undefined,
): boolean {
  return (
    conversation.type === 'direct' &&
    conversation.membersPreview.length === 1 &&
    conversation.membersPreview[0]?.id === meId
  );
}

/** Собеседник личного чата: сервер кладёт в `membersPreview` всех, КРОМЕ
 *  зрителя (у «Избранного» — сам зритель, поэтому фильтр по `meId`).
 *  У группы/канала/чата задачи собеседника нет — null. */
export function directPeer(
  conversation: ConversationListItem,
  meId?: string | null,
): UserRef | null {
  if (conversation.type !== 'direct') return null;
  return conversation.membersPreview.find((member) => member.id !== meId) ?? null;
}

/** Фото для аватара БЕСЕДЫ (#726): загруженный аватар беседы приоритетен, а у
 *  личного чата (своего аватара у него не бывает) — фото собеседника. Один
 *  источник для списка бесед, экспресс-полосы, бара и панели профиля. */
export function conversationAvatarUrl(
  conversation: ConversationListItem,
  meId?: string | null,
): string | null {
  return conversation.avatarUrl ?? directPeer(conversation, meId)?.avatarUrl ?? null;
}

/** Заголовок беседы: у канала/группы — название, у чата задачи — «№ · тема»,
 *  у чата письма — «рег.№ · тема» (без номера — тема), у личного — имя
 *  собеседника, у диалога с собой — «Избранное». */
export function conversationTitle(
  conversation: ConversationListItem,
  meId?: string | null,
): string {
  if (conversation.type === 'task' && conversation.task) {
    return `№ ${conversation.task.number} · ${conversation.task.title}`;
  }
  if (conversation.type === 'letter' && conversation.letter) {
    const ref = conversation.letter.regNumber;
    // Бумажный скан до регистрации может быть без темы (#55).
    const subject = conversation.letter.subject ?? ui.letters.noSubject;
    return ref ? `${ref} · ${subject}` : subject;
  }
  if (isNotesConversation(conversation, meId)) return ui.chat.notes;
  return conversation.title ?? withoutPatronymic(conversation.membersPreview[0]?.displayName ?? '');
}

/** Единый список бесед по активности (вердикт владельца 2026-09-10, раунд 2):
 *  БЕЗ секций-заголовков — типы перемешаны, свежие сверху; закреплённые
 *  (ПКМ-меню, реф Битрикс24) — ВСЕГДА сверху, между собой по активности;
 *  беседы без сообщений — в конце (стабильно, в исходном порядке).
 *  Черновики (#91, реф Telegram/Bitrix24): беседа с черновиком поднимается
 *  СРАЗУ за закреплёнными (закреп выше черновика — канон обоих мессенджеров);
 *  hasDraft — клиентские черновики, серверный draft листа догоняет меткой. */
export function sortByActivity(
  conversations: ConversationListItem[],
  hasDraft?: (conversationId: string) => boolean,
): ConversationListItem[] {
  const rank = (c: ConversationListItem) => (c.pinned ? 0 : (hasDraft?.(c.id) ?? false) ? 1 : 2);
  // Ключ активности — lastActivityAt (сообщения ИЛИ звезда «Избранного»,
  // #215): сервер считает GREATEST(last_message_at, последняя закладка);
  // превью-поле lastMessage отстаёт (звезда не создаёт сообщение) —
  // фолбэк на него только для старых/нулевых значений.
  const activityAt = (c: ConversationListItem): string | null =>
    c.lastActivityAt ?? c.lastMessage?.createdAt ?? null;
  return [...conversations].sort((a, b) => {
    const tier = rank(a) - rank(b);
    if (tier !== 0) return tier;
    const ta = activityAt(a);
    const tb = activityAt(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb.localeCompare(ta);
  });
}

/** Подзаголовок активной беседы: тип + участники (русская деловая форма).
 *  Название ПРОЕКТА и номер задачи НЕ повторяем: они уже в заголовке строки
 *  (вердикт владельца 15.09.2026: «дублирование названий проекта в чатах»). */
export function conversationSubtitle(conversation: ConversationListItem): string {
  if (conversation.type === 'project_channel') {
    // Канал без привязки к проекту (новости компании) — просто «Канал».
    return conversation.project ? ui.chat.channelOfProject : ui.chat.channelGeneric;
  }
  if (conversation.type === 'task') {
    return ui.chat.taskChat;
  }
  if (conversation.type === 'letter') {
    return ui.chat.letterChat;
  }
  const members = conversation.membersPreview.length;
  if (conversation.type === 'group') {
    return `${ui.chat.groupChat} · ${members} ${plural(members, [
      ui.chat.membersCountOne,
      ui.chat.membersCountFew,
      ui.chat.membersCountMany,
    ])}`;
  }
  return ui.common.online;
}

/** Иерархия ролей беседы (owner > admin > member). */
const ROLE_RANK: Record<ConversationListItem['myRole'], number> = { member: 0, admin: 1, owner: 2 };

/** Право публиковать КОРНЕВЫЕ посты в ленту канала/беседы (матрица прав,
 *  #91/#58: ответы в тредах открыты всем участникам независимо от post). */
export function canPostFeed(conversation: ConversationListItem): boolean {
  if (conversation.readOnly) return false;
  return ROLE_RANK[conversation.myRole] >= ROLE_RANK[conversation.permissions.post];
}

/** Права матрицы беседы для UI (#186): контролы скрываются/гасятся без права;
 *  API проверяет то же на гвардах (I8) — это производная, не замена. */
export function canChangeInfo(conversation: ConversationListItem): boolean {
  return ROLE_RANK[conversation.myRole] >= ROLE_RANK[conversation.permissions.changeInfo];
}

/** Состав чатов задач и писем ведёт сущность (#252): вручную — никому. */
const ENTITY_MANAGED = new Set(['task', 'letter']);

export function canAddMembers(conversation: ConversationListItem): boolean {
  if (ENTITY_MANAGED.has(conversation.type)) return false;
  return ROLE_RANK[conversation.myRole] >= ROLE_RANK[conversation.permissions.addMembers];
}

export function canRemoveMembers(conversation: ConversationListItem): boolean {
  if (ENTITY_MANAGED.has(conversation.type)) return false;
  return ROLE_RANK[conversation.myRole] >= ROLE_RANK[conversation.permissions.removeMembers];
}

export function canManageSettings(conversation: ConversationListItem): boolean {
  return ROLE_RANK[conversation.myRole] >= ROLE_RANK[conversation.permissions.manageSettings];
}

/** Название беседы редактируется кликом только у групп/каналов (у
 *  direct/task/letter оно производное от сущности). */
export function isRenamableConversation(conversation: ConversationListItem): boolean {
  return conversation.type === 'group' || conversation.type === 'project_channel';
}
