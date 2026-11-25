import { extractMentionIds } from '@nodus/contracts';
import type { ChatMessage, MessageAttachment, MessagePin, ReplyPreview } from '@nodus/contracts';

import { demoConversations, demoMessages, demoPins } from '../../../../shared/mocks/data/chat.js';
import { actorUserRef } from '../../../../shared/mocks/mock-actor.js';
import { favoriteMocks } from './favorite-handlers.js';

/**
 * Состояние мок-домена чата для мутаций линии A (#87): загруженные вложения,
 * закрепы, правило удаления со следом, снапшоты цитат. Чистые операции над
 * общими демо-массивами (один стор ленты — канон chat.ts).
 */

/** Загруженные, но ещё не привязанные к сообщению вложения
 *  (POST /chat/attachments → attachmentIds отправки). */
export const uploadedAttachments = new Map<string, MessageAttachment>();

/** Усечение сниппета цитаты (серверная сторона снапшота). */
export const REPLY_SNIPPET_MAX = 160;

/** Снапшот цитаты — ЗАМОРОЖЕННЫЙ на момент отправки (вердикт 24.09).
 *  Оригинал удалён (или исчез бесследно) → deleted: true, контент пуст:
 *  удаление сильнее заморозки (канон Telegram lng_deleted_message). */
export function buildReplyPreview(replyToId: string, quoteText?: string | null): ReplyPreview {
  const target = demoMessages.find((m) => m.id === replyToId);
  if (!target || target.deletedAt) {
    return {
      id: replyToId,
      author: target?.author ?? null,
      text: '',
      quoteText: null,
      attachmentKind: null,
      deleted: true,
      // removeMessage вынул строку из демо-массива (бесследно); tombstone
      // остаётся в ленте — цитата на него кликабельна (паритет #163).
      obliterated: !target,
    };
  }
  return {
    id: target.id,
    author: target.author,
    text: target.text.slice(0, REPLY_SNIPPET_MAX),
    quoteText: quoteText ? quoteText.slice(0, REPLY_SNIPPET_MAX) : null,
    attachmentKind: target.attachments[0]?.kind ?? null,
    deleted: false,
    obliterated: false,
  };
}

/** «Избранное» (#215): беседа с собой (direct, единственный участник) —
 *  удаление всегда БЕСЛЕДНО, надгробия не оставляем (паритет серверному
 *  гварду MessagesService.deleteInternal → isNotesConversation; выродившаяся
 *  группа/канал с 1 участником под гвард НЕ попадает). */
export function isSelfConversation(conversationId: string): boolean {
  const conversation = demoConversations.find((c) => c.id === conversationId);
  return conversation?.type === 'direct' && conversation.membersPreview.length === 1;
}

/** Правило следа (#163, вердикт владельца 30.09 «по ответам»): след держат
 *  только живые ответы (reply.id либо пост треда, не удалённые) — прочтения
 *  не участвуют. Прод-сервер решает по reply_to_id/thread_root_id с
 *  deleted_at IS NULL; мок — по демо-ленте (правило паритетно). */
export function hasLiveReplies(message: ChatMessage): boolean {
  return demoMessages.some(
    (m) =>
      m.conversationId === message.conversationId &&
      m.id !== message.id &&
      !m.deletedAt &&
      (m.reply?.id === message.id || m.threadRootId === message.id),
  );
}

/** Каскад #163: надгробие-якорь (родитель по цитате / корень треда),
 *  потерявшее последний живой ответ, уходит из ленты бесследно. Якоря
 *  захватываются ДО applyDeletion (она обнуляет reply). */
export function collapseAnchors(
  conversationId: string,
  anchors: (string | null | undefined)[],
): void {
  for (const anchorId of new Set(
    anchors.filter((id): id is string => id !== null && id !== undefined),
  )) {
    const anchor = demoMessages.find(
      (m) => m.id === anchorId && m.conversationId === conversationId && m.deletedAt,
    );
    if (anchor && !hasLiveReplies(anchor)) removeMessage(anchor.id);
  }
}

/** «Удаление сильнее заморозки»: цитаты-ответы → deleted (+obliterated у
 *  бесследно исчезнувшего оригинала — клику некуда вести, паритет #163). */
export function markRepliesDeleted(messageId: string, obliterated: boolean): void {
  for (const m of demoMessages) {
    if (m.reply?.id === messageId && !m.reply.deleted) {
      m.reply = { ...m.reply, deleted: true, obliterated };
    }
  }
}

export function unpinById(conversationId: string, messageId: string): boolean {
  const index = demoPins.findIndex(
    (p) => p.message.id === messageId && p.message.conversationId === conversationId,
  );
  const pin = index >= 0 ? demoPins[index] : undefined;
  if (!pin) return false;
  pin.message.pinned = false;
  demoPins.splice(index, 1);
  return true;
}

/** Удаление СО СЛЕДОМ: надгробие на месте сообщения (текст/вложения/реакции
 *  очищены, авто-анпин — канон: удаление закреплённого спускает пин).
 *  Закладки гаснут сразу (#215 — паритет серверному каскаду deleteInternal). */
export function applyDeletion(message: ChatMessage): ChatMessage {
  message.deletedAt = new Date().toISOString();
  message.text = '';
  message.attachments = [];
  message.reactions = [];
  message.reply = null;
  unpinById(message.conversationId, message.id);
  favoriteMocks.delete(message.id);
  markRepliesDeleted(message.id, false);
  return message;
}

/** Удаление БЕЗ СЛЕДА (#163 — нет живых ответов): строка уходит из демо-ленты;
 *  цитаты-ответы получают obliterated — кликать некуда (паритет прод-маппера).
 *  Закладки гаснут сразу (#215 — паритет серверному каскаду deleteInternal). */
export function removeMessage(messageId: string): void {
  const index = demoMessages.findIndex((m) => m.id === messageId);
  if (index < 0) return;
  const [gone] = demoMessages.splice(index, 1);
  if (!gone) return;
  unpinById(gone.conversationId, gone.id);
  favoriteMocks.delete(messageId);
  markRepliesDeleted(messageId, true);
}

/** lastMessage беседы после мутаций (лента-стор меняется inplace). */
export function refreshLastMessage(conversationId: string): void {
  const conversation = demoConversations.find((c) => c.id === conversationId);
  if (!conversation) return;
  const last = [...demoMessages]
    .reverse()
    .find((m) => m.conversationId === conversationId && m.threadRootId === null);
  conversation.lastMessage = last ?? null;
}

export function pinsOf(conversationId: string): MessagePin[] {
  return demoPins.filter((p) => p.message.conversationId === conversationId);
}

/** Закреп (идемпотентно: повторный pin вернёт существующий). Свежий закреп
 *  первым — пин-бар показывает pins[0] (канон Telegram). */
export function pinMessage(conversationId: string, messageId: string): MessagePin | null {
  const message = demoMessages.find(
    (m) => m.id === messageId && m.conversationId === conversationId && !m.deletedAt,
  );
  if (!message) return null;
  const existing = demoPins.find((p) => p.message.id === messageId);
  if (existing) return existing;
  const pin: MessagePin = {
    message,
    pinnedBy: actorUserRef(),
    pinnedAt: new Date().toISOString(),
  };
  demoPins.unshift(pin);
  message.pinned = true;
  return pin;
}

/** Скрытые из списка беседы (ПКМ «Скрыть»: история сохраняется, I15).
 *  Активность (отправка/пересылка) раскрывает беседу у всех скрывших —
 *  модель Битрикс24 (#103). */
export const hiddenConversations = new Set<string>();

export function revealHiddenConversation(conversationId: string): void {
  hiddenConversations.delete(conversationId);
}

/**
 * Квитанция просмотров (#102 раунд 2): просмотр = видимость в вьюпорте.
 * Мок-модель: гасит unread беседы; собеседник «просматривает» то же видимое
 * (минимальная симуляция по квитанции клиента — живого пира в моках нет):
 * СВОИ сообщения с seq ≤ upToSeq получают readAt + первого не-автора в
 * readBy (модель первого прочитавшего); после правки (readAt сброшен)
 * повторный просмотр восстанавливает. Клиент делает отложенную инвалидацию
 * после квитанции (use-viewport-read) — галочки переключаются без polling.
 */
/** Следующий seq беседы (мок-эквивалент allocateSeqs: 1..n по порядку). */
export function nextMessageSeq(conversationId: string): number {
  return (
    Math.max(
      0,
      ...demoMessages.filter((m) => m.conversationId === conversationId).map((m) => m.seq),
    ) + 1
  );
}

export function applyReadReceipt(
  conversationId: string,
  upToSeq: number,
  threadRootId: string | null = null,
): number {
  const conversation = demoConversations.find((c) => c.id === conversationId);
  if (!conversation) return -1;
  conversation.unreadCount = 0;
  const now = new Date().toISOString();
  for (const m of demoMessages) {
    if (m.conversationId !== conversationId || m.deletedAt || m.seq > upToSeq) continue;
    // #1026/#1032: квитанция имеет область — лента не ставит галку ответам
    // треда, чтение треда не делает прочитанным пост ленты (как сервер/DTO).
    if (threadRootId === null ? m.threadRootId !== null : m.threadRootId !== threadRootId) continue;
    const reader = conversation.membersPreview.find((u) => u.id !== m.author.id);
    if (!reader) continue; // «Заметки»: просмотров нет
    if (m.readAt === null) m.readAt = now;
    if (!m.readBy.some((u) => u.id === reader.id)) m.readBy = [...m.readBy, reader];
  }
  return upToSeq;
}

/** Наблюдатели трэдов (раунд 3): rootId → userId → watermark трэда. Мок-модель
 *  минимальна: реплай в трэд делает наблюдателем, @упоминание — тоже,
 *  кнопка «Следить» — toggle; квитанция из треда двигает watermark (точка). */
export const threadWatchers = new Map<string, Map<string, number>>();

/** Карта наблюдателей трэда (создаётся по необходимости). */
export function threadWatchersOf(threadRootId: string): Map<string, number> {
  let watchers = threadWatchers.get(threadRootId);
  if (!watchers) {
    watchers = new Map();
    threadWatchers.set(threadRootId, watchers);
  }
  return watchers;
}

export function watchThreadMock(threadRootId: string, userId: string): boolean {
  const watchers = threadWatchersOf(threadRootId);
  if (watchers.has(userId)) {
    watchers.delete(userId);
    return false;
  }
  watchers.set(userId, 0);
  return true;
}

/** Квитанция из треда: гасит «есть новые» (чужие ответы ≤ upToSeq прочитаны). */
export function applyThreadReadReceipt(
  threadRootId: string,
  userId: string,
  upToSeq: number,
): void {
  const watchers = threadWatchers.get(threadRootId);
  if (!watchers?.has(userId)) return;
  watchers.set(userId, Math.max(watchers.get(userId) ?? 0, upToSeq));
}

/** Состояния трэдов беседы для текущего пользователя (mock GET threads/state):
 *  строка на каждый трэд, где он наблюдатель. */
export function threadStatesMock(conversationId: string, userId: string) {
  const items: { threadRootId: string; watched: boolean; unreadCount: number }[] = [];
  for (const [threadRootId, watchers] of threadWatchers) {
    const watermark = watchers.get(userId);
    if (watermark === undefined) continue;
    const root = demoMessages.find(
      (m) => m.id === threadRootId && m.conversationId === conversationId,
    );
    if (!root) continue;
    const unreadCount = demoMessages.filter(
      (m) =>
        m.threadRootId === threadRootId &&
        !m.deletedAt &&
        m.author.id !== userId &&
        m.seq > watermark,
    ).length;
    items.push({ threadRootId, watched: true, unreadCount });
  }
  return items;
}

/** Toggle реакции (#124, паритет серверной семантике message-actions):
 *  remove/декремент — исчезновение на нуле; add — инкремент или новый чип;
 *  повторный add по своей — no-op. Mine — против актёра мока. */
export function toggleReaction(message: ChatMessage, emoji: string, remove: boolean): void {
  const actor = actorUserRef();
  const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
  if (remove) {
    message.reactions = message.reactions
      .map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              users: reaction.users.filter((user) => user.id !== actor.id),
              mine: false,
            }
          : reaction,
      )
      .map((reaction) => ({ ...reaction, count: reaction.users.length }))
      .filter((reaction) => reaction.count > 0);
    return;
  }
  if (existing) {
    if (existing.mine) return;
    message.reactions = message.reactions.map((reaction) =>
      reaction.emoji === emoji
        ? {
            ...reaction,
            users: [...reaction.users, actor],
            count: reaction.users.length + 1,
            mine: true,
          }
        : reaction,
    );
    return;
  }
  message.reactions = [...message.reactions, { emoji, count: 1, mine: true, users: [actor] }];
}

/** @упоминания мока (#176, паритет серверу): токены `@[текст](user:id)` из
 *  текста → валидные id справочника, без автора. Правило «уведомлять только
 *  участников» в моке приближено справочником — полной матрицы
 *  conversation_members здесь нет (мок — паритет контрактов, не БД). */
export function mockMentionTargets(
  text: string,
  authorId: string,
  isValidUser: (id: string) => boolean,
): string[] {
  return extractMentionIds(text).filter((id) => id !== authorId && isValidUser(id));
}

/** Роли участников бесед (#186, мок): overrides поверх дефолта (актёр —
 *  owner созданных им бесед, прочие — member); живой контур хранит роли
 *  в conversation_members — здесь только паритет контрактов. */
const mockMemberRoles = new Map<string, Map<string, 'owner' | 'admin' | 'member'>>();

export function mockMemberRole(
  conversationId: string,
  userId: string,
  fallback: 'owner' | 'admin' | 'member',
): 'owner' | 'admin' | 'member' {
  return mockMemberRoles.get(conversationId)?.get(userId) ?? fallback;
}

export function setMockMemberRole(
  conversationId: string,
  userId: string,
  role: 'admin' | 'member',
): void {
  const byConversation = mockMemberRoles.get(conversationId) ?? new Map();
  byConversation.set(userId, role);
  mockMemberRoles.set(conversationId, byConversation);
}
