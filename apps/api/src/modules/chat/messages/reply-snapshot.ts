import { stripMentionTokens, truncateMentionText } from '@nodus/contracts';

import type { ReplySnapshotValue } from './message-reply-preview.js';

/** Усечение сниппета цитаты и частичной цитаты (мок: REPLY_SNIPPET_MAX = 160). */
export const REPLY_SNIPPET_MAX = 160;

export interface ReplyOriginalInput {
  authorId: string;
  text: string;
  deleted: boolean;
  /** Вид первого вложения — подпись «Фото»/«Файл»/«Стикер» в цитате без текста. */
  attachmentKind: 'image' | 'video' | 'file' | 'sticker' | null;
  /** #288: оригинал-стикер — fileId для мини-глифа в цитате (url строится
   *  ПОДПИСЬЮ при чтении: замороженный снапшот не хранит протухающие ссылки)
   *  и первый эмодзи пака. */
  stickerFileId: string | null;
  stickerEmoji: string | null;
  stickerMime: string | null;
}

/** Отображаемая форма: любые пробельные серии (в т.ч. невидимые U+FEFF,
 *  NBSP) → один пробел, токены упоминаний → подписи чипов (как в пузыре и
 *  в выделении браузера). Пробелы — ДО токенов (подпись не содержит
 *  перевода строки: схлопнутый `\n` иначе собрал бы токен заново), токены —
 *  до неподвижной точки (снятие внешнего токена не должно склеить новый). */
function displayText(text: string): string {
  let out = text.replace(/\s+/g, ' ');
  for (let i = 0; i < 8; i += 1) {
    const next = stripMentionTokens(out);
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Частичная цитата (#346, модель Telegram Replies 2.0) — фрагмент
 * ОТОБРАЖАЕМОГО текста оригинала: клиент присылает выделение из пузыря.
 * Возвращает каноническую форму (её и хранить: сверенная строка =
 * сохранённая, без токенов и невидимых символов) или null, если фрагмента
 * в оригинале нет. Выделение ЧЕРЕЗ ссылку на сущность, которую пузырь
 * заменил карточкой, не засчитывается — ответ на всё сообщение: склейка
 * слов по обе стороны скрытой ссылки дала бы фразу, которой автор не писал.
 */
export function canonicalQuote(originalText: string, quoteText: string): string | null {
  const quote = displayText(quoteText);
  if (quote.length === 0) return null;
  return displayText(originalText).includes(quote) ? quote : null;
}

/**
 * Снапшот цитаты строит СЕРВЕР в момент отправки (мок-семантика):
 * текст и частичная цитата усекаются до REPLY_SNIPPET_MAX, вложение —
 * только вид (не содержимое). Удалённый/несуществующий оригинал:
 * authorId сохраняется, если оригинал был надгробием (строка жива),
 * null — если оригинала нет; text/quote/attachmentKind затираются.
 * Снапшот заморожен навсегда; deleted-флаг вычисляет маппер по строке.
 * Частичная цитата, которой нет в тексте оригинала, отбрасывается (#346):
 * ответ становится цитатой всего сообщения — легитимный клиент не
 * промахивается, расхождение рендера не ломает отправку.
 */
export function buildReplySnapshot(
  original: ReplyOriginalInput | null,
  quoteText: string | null | undefined,
): ReplySnapshotValue {
  if (!original || original.deleted) {
    return {
      authorId: original?.authorId ?? null,
      text: '',
      quoteText: null,
      attachmentKind: null,
      stickerFileId: null,
      stickerEmoji: null,
      stickerMime: null,
    };
  }
  // Токен-знающая обрезка (#224): срез по границам сегментов — замороженный
  // снапшот никогда не хранит огрызок `@[Имя](user:…` (цитата без кода).
  return {
    authorId: original.authorId,
    text: truncateMentionText(original.text, REPLY_SNIPPET_MAX),
    quoteText: quoteText ? quoteSnippet(original.text, quoteText) : null,
    attachmentKind: original.attachmentKind,
    stickerFileId: original.stickerFileId,
    stickerEmoji: original.stickerEmoji,
    stickerMime: original.stickerMime,
  };
}

function quoteSnippet(originalText: string, quoteText: string): string | null {
  const quote = canonicalQuote(originalText, quoteText);
  return quote === null ? null : Array.from(quote).slice(0, REPLY_SNIPPET_MAX).join('');
}
