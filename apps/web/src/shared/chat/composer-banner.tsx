import { Pencil, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { withoutPatronymic } from '../lib/format.js';
import { personTone } from '../ui/person-tone.js';
import type { ChatDraft } from './chat-drafts.js';

/** Подпись медийного оригинала без текста (канон Telegram reply_media:
 *  «Фото» / «Файл» в цитате; стикер — «Стикер 🙂» с эмодзи пака, #288). */
function replySnippet(draft: ChatDraft): string {
  const reply = draft.reply;
  if (!reply) return '';
  if (reply.quoteText) return `«${reply.quoteText}»`;
  if (reply.snippet) return reply.snippet;
  if (reply.attachmentKind === 'image') return ui.chat.quotePhoto;
  if (reply.attachmentKind === 'video') return ui.chat.quoteVideo;
  if (reply.attachmentKind === 'sticker')
    return reply.stickerEmoji
      ? `${ui.chat.stickerPreview} ${reply.stickerEmoji}`
      : ui.chat.stickerPreview;
  return ui.chat.quoteFile;
}

/**
 * Бар режима композера (A2/A4, #87): ответ-цитата ИЛИ правка — одна механика
 * (канон tdesktop: режимы взаимоисключающие, edit-бар замещает reply-бар).
 * Ответ: имя автора (ПЕРСОНАЛЬНЫЙ цвет, #180 — тон палитры --name-*, как
 * в цитате пузыря) + сниппет/фрагмент; клик по телу — прыжок к
 * оригиналу (Ctrl+клик reply-бара tdesktop 4.11.2 — у нас обычный клик:
 * веб-канон Slack/Discord). Правка: метка «Редактирование сообщения» +
 * оригинальный текст. Крестик и Esc отменяют режим (Esc-каскад — канон
 * Discord: сначала режимы композера, потом слайдер).
 * Плоско: ступень тона bg-accent/40, акцентная линия слева (info), без
 * разделителей (канон 24.09: линии — только границы функциональных зон).
 *
 * Реиспользуется вне композера (#288): окно отправки вложений рисует ту же
 * плашку над списком файлов. Там className задаёт скругление карточкой
 * (tailwind-merge перебивает rounded-t), а onJump не передаётся — тело
 * рендерится спаном: за модалом лента не видна, прыжок сбивчив; крестик
 * отмены остаётся.
 */
export function ComposerBanner({
  draft,
  onCancel,
  onJump,
  className,
}: {
  draft: ChatDraft;
  onCancel: () => void;
  onJump?: () => void;
  className?: string;
}) {
  const isEdit = draft.edit !== null;
  const bodyClass = cn(
    'flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md px-1 text-left',
    onJump && 'transition-colors hover:bg-accent/60',
  );
  const body = (
    <>
      <span
        className={cn(
          'truncate text-xs font-semibold',
          draft.reply ? personTone(draft.reply.author.id) : '',
        )}
      >
        {draft.reply ? withoutPatronymic(draft.reply.author.displayName) : null}
      </span>
      <span className="truncate text-xs text-muted-foreground">{replySnippet(draft)}</span>
    </>
  );
  return (
    <span
      className={cn(
        // min-w-0: в окне вложений плашка — прямой ребёнок grid DialogContent,
        // без него min-content nowrap-сниппета растягивает окно (блокер ui #288)
        'flex min-w-0 items-stretch gap-1.5 rounded-t-[10px] bg-accent/40 py-1.5 pr-1.5 pl-2.5',
        className,
      )}
    >
      <span aria-hidden className="w-0.5 shrink-0 rounded-full bg-info" />
      {isEdit ? (
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-info">
            <Pencil className="size-3" strokeWidth={1.75} />
            {ui.chat.editBanner}
          </span>
          <span className="truncate text-xs text-muted-foreground">{draft.edit?.originalText}</span>
        </span>
      ) : onJump ? (
        <button type="button" onClick={onJump} className={bodyClass}>
          {body}
        </button>
      ) : (
        <span className={bodyClass}>{body}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 self-center text-muted-foreground"
        onClick={onCancel}
        aria-label={ui.common.cancel}
      >
        <X />
      </Button>
    </span>
  );
}
