import { Star } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { SnippetText } from '../search/snippet-text.js';
import { MentionSnippet } from './mention-chip.js';

/** Вложение строки — словом, не рендером (реф Битрикс24, 04.10 р.5). */
export function attachmentWord(kind: 'image' | 'file' | 'sticker'): string {
  if (kind === 'image') return ui.chat.searchAttachImage;
  if (kind === 'sticker') return ui.chat.searchAttachSticker;
  return ui.chat.searchAttachFile;
}

/**
 * Строка закладки в списках выдачи (реф Битрикс24, вердикт 04.10 р.5):
 * полное имя-фамилия своей строкой (рядом ничего нет — не режется), текст
 * до 3 строк, вложения словами; времени в строке НЕТ — группировка
 * заголовками дат делает список; звезда-заливка — справа ВНИЗУ, строку
 * имени не занимает. ЕДИНЫЙ компонент для поисковой панели и вкладки
 * «Избранное» панели беседы (один вид — консистентность). Кликом — прыжок.
 */
export function FavoriteHitRow({
  author,
  snippet,
  attachments,
  favorited = true,
  highlightSnippet = false,
  onJump,
}: {
  author: string;
  snippet: string;
  attachments: ('image' | 'file' | 'sticker')[];
  /** Индикатор «в избранном» — только у закладок; записи витрины — без
   *  звезды (сообщения самому себе — ещё не избранное, 04.10 р.7). */
  favorited?: boolean;
  /** Сниппет серверного поиска: маркеры `\u0001/\u0002` → подсветка (#956). */
  highlightSnippet?: boolean;
  onJump: () => void;
}) {
  const words = attachments.map(attachmentWord).join(' · ');
  return (
    <button
      type="button"
      onClick={onJump}
      className="relative flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 pr-8 text-left transition-colors hover:bg-accent/60"
    >
      <span className="w-full truncate text-sm font-semibold text-foreground">{author}</span>
      <span className="line-clamp-3 w-full text-sm leading-snug text-muted-foreground">
        {words ? `${words}\u00A0· ` : ''}
        {highlightSnippet ? (
          <SnippetText text={snippet || '\u00A0'} />
        ) : (
          <MentionSnippet text={snippet || '\u00A0'} />
        )}
      </span>
      {/* Индикатор «в избранном» — залитая звезда справа внизу строки. */}
      {favorited ? (
        <span
          className="absolute right-2 bottom-1.5 flex text-info"
          title={ui.chat.favoriteBadge}
          aria-label={ui.chat.favoriteBadge}
        >
          <Star className="size-3.5" fill="currentColor" strokeWidth={0} />
        </span>
      ) : null}
    </button>
  );
}
