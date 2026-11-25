import {
  truncateMentionText,
  type ChatMessage,
  type ReplyPreview,
  type UserRef,
} from '@nodus/contracts';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import type { MessageRow } from './message-row.js';

/**
 * Цитата-ответ и атрибуция пересылки в DTO сообщения (снапшот цитаты
 * заморожен при отправке — reply-snapshot.ts). Выделено из
 * message-dto.mapper (I5).
 */

/** Замороженный снапшот цитаты (поле reply_snapshot). */
export interface ReplySnapshotValue {
  authorId: string | null;
  text: string;
  quoteText: string | null;
  attachmentKind: 'image' | 'video' | 'file' | 'sticker' | null;
  /** #288: мини-глиф оригинального стикера в цитате — fileId (url строится
   *  подписью при чтении) + первый эмодзи пака. Старые снапшоты — без полей. */
  stickerFileId?: string | null;
  stickerEmoji?: string | null;
  stickerMime?: string | null;
}

/** Fallback-профиль: пользователя нет в справочнике (крайний случай). */
export function fallbackRef(id: string): UserRef {
  return { id, displayName: 'Пользователь', avatarUrl: null };
}

/**
 * Цитата: текст/quoteText/attachmentKind заморожены в снапшоте на момент
 * отправки (правка оригинала не меняет — вердикт 24.09); удалённость
 * оригинала вычисляется по строке (удаление сильнее заморозки). Строки
 * оригиналов не удаляются физически (obliterated остаётся в БД) — автор
 * цитаты известен всегда из замороженного снапшота; null возможен только
 * у legacy-снапшотов без автора.
 */
export function buildReplyPreview(
  row: MessageRow,
  refs: Map<string, UserRef>,
  originalById: Map<string, MessageRow>,
  signedUrls: SignedUrlService,
): ReplyPreview | null {
  if (!row.replyToId) return null;
  const snapshot = (row.replySnapshot ?? null) as ReplySnapshotValue | null;
  // Оригинал засчитывается только из той же беседы (#344): legacy-ссылка на
  // сообщение чужой беседы не раскрывает его автора и состояние.
  const candidate = originalById.get(row.replyToId);
  const original = candidate?.conversationId === row.conversationId ? candidate : undefined;
  const deleted = original === undefined || original.deletedAt !== null;
  // #163: obliterated-оригинала в ленте нет — клику по цитате некуда вести;
  // deleted при надгробии (obliterated=false) — цитата кликабельна.
  const obliterated = original === undefined || original.obliterated;
  const authorId = snapshot?.authorId ?? original?.authorId ?? null;
  return {
    id: row.replyToId,
    author: authorId === null ? null : (refs.get(authorId) ?? fallbackRef(authorId)),
    // Фолбэк без снапшота — та же токен-знающая обрезка (#224): цитата
    // без огрызков `@[Имя](user:…`.
    text: deleted
      ? ''
      : (snapshot?.text ?? (original ? truncateMentionText(original.text, 160) : '')),
    quoteText: deleted ? null : (snapshot?.quoteText ?? null),
    attachmentKind: deleted ? null : (snapshot?.attachmentKind ?? null),
    // #288: мини-глиф оригинального стикера; url подписывается при ЧТЕНИИ —
    // снапшот хранит только fileId (протухающие ссылки замораживать нельзя).
    stickerUrl:
      !deleted && snapshot?.stickerFileId
        ? signedUrls.fileContentUrl(snapshot.stickerFileId)
        : null,
    stickerEmoji: deleted ? null : (snapshot?.stickerEmoji ?? null),
    stickerMime: deleted ? null : (snapshot?.stickerMime ?? null),
    deleted,
    obliterated,
  };
}

export function buildForwardedFrom(
  row: MessageRow,
  refs: Map<string, UserRef>,
): ChatMessage['forwardedFrom'] {
  if (!row.fwdMessageId || !row.fwdAuthorId || !row.fwdConversationId) return null;
  return {
    author: refs.get(row.fwdAuthorId) ?? fallbackRef(row.fwdAuthorId),
    conversationId: row.fwdConversationId,
    messageId: row.fwdMessageId,
    threadRootId: row.fwdThreadRootId,
  };
}
