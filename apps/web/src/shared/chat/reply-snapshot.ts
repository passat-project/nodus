import type { ChatMessage, ReplyPreview, UserRef } from '@nodus/contracts';

/**
 * Клиентский снапшот цитаты (A2, #87): черновик ответа хранится ПЛОСКИМ
 * (персистится в localStorage — ссылки на ChatMessage не переживают reload),
 * при оптимистичной отправке собирается в ReplyPreview контракта; сервер
 * возвращает канонический снапшот (замороженный — вердикт 24.09).
 */

export const REPLY_SNIPPET_MAX = 160;

export interface ReplyDraft {
  messageId: string;
  author: UserRef;
  /** Сниппет текста оригинала (усечён); '' у чисто медийного сообщения. */
  snippet: string;
  /** Частичная цитата: выделенный автором фрагмент (Replies 2.0). */
  quoteText: string | null;
  attachmentKind: 'image' | 'video' | 'file' | 'sticker' | null;
  /** #288: мини-глиф оригинального СТИКЕРА в цитате (url + первый эмодзи
   *  пака + mime); null у остальных видов и старых черновиков. */
  stickerUrl: string | null;
  stickerEmoji: string | null;
  stickerMime: string | null;
  /** Оригинал живёт в треде канала — прыжок по цитате целится в окно треда. */
  inThread: string | null;
}

export function replyDraftFrom(message: ChatMessage, quoteText?: string | null): ReplyDraft {
  const first = message.attachments[0];
  return {
    messageId: message.id,
    author: message.author,
    snippet: message.text.slice(0, REPLY_SNIPPET_MAX),
    quoteText: quoteText ? quoteText.slice(0, REPLY_SNIPPET_MAX) : null,
    attachmentKind: first?.kind ?? null,
    stickerUrl: first?.kind === 'sticker' ? (first.url ?? null) : null,
    stickerEmoji: first?.kind === 'sticker' ? (first.sticker?.emojis[0] ?? null) : null,
    stickerMime: first?.kind === 'sticker' ? first.mime : null,
    inThread: message.threadRootId,
  };
}

export function toReplyPreview(draft: ReplyDraft): ReplyPreview {
  return {
    id: draft.messageId,
    author: draft.author,
    text: draft.snippet,
    quoteText: draft.quoteText,
    attachmentKind: draft.attachmentKind,
    stickerUrl: draft.stickerUrl,
    stickerEmoji: draft.stickerEmoji,
    stickerMime: draft.stickerMime,
    deleted: false,
    obliterated: false,
  };
}

/** Возврат упавшей отправки (#248): превью контракта из переменных мутации →
 *  плоский черновик ответа; null — оригинал стёрт бесследно (author нет),
 *  цитате некуда вести — ответ не восстанавливаем, текст важнее. inThread в
 *  превью нет: прыжок по цитате тредового оригинала откроет ленту, не окно
 *  треда; для повтора отправки не критично. */
export function replyDraftFromPreview(preview: ReplyPreview): ReplyDraft | null {
  if (!preview.author) return null;
  return {
    messageId: preview.id,
    author: preview.author,
    snippet: preview.text,
    quoteText: preview.quoteText ?? null,
    attachmentKind: preview.attachmentKind ?? null,
    stickerUrl: preview.stickerUrl ?? null,
    stickerEmoji: preview.stickerEmoji ?? null,
    stickerMime: preview.stickerMime ?? null,
    inThread: null,
  };
}
