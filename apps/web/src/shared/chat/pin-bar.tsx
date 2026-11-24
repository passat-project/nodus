import { ChevronDown, ChevronUp, LayoutList, Pin, PinOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { stripMentionTokens, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { formatTime, withoutPatronymic } from '../lib/format.js';
import { usePins } from './pin-mutations.js';

import { useUnpinDialog } from './dialog-stores.js';
import { useJumpStore } from './jump-store.js';

/** Выдержка закрепа: текст или подпись медиа (канон Telegram: бар показывает
 *  превью сообщения; удалённый закреп — placeholder). */
function pinSnippet(
  text: string,
  kind: 'image' | 'video' | 'file' | 'sticker' | null,
  deleted: boolean,
): string {
  if (deleted) return ui.chat.deletedPlaceholder;
  // Однострочный truncate: упоминание — отображаемым текстом (канон Telegram).
  if (text) return stripMentionTokens(text);
  if (kind === 'image') return ui.chat.quotePhoto;
  if (kind === 'video') return ui.chat.quoteVideo;
  if (kind === 'file') return ui.chat.quoteFile;
  if (kind === 'sticker') return ui.chat.stickerPreview;
  return '';
}

/**
 * Лента закрепов беседы (A3, #87): ОДИН закреп за раз (канон tdesktop),
 * счётчик «N / M» + стрелки цикла (Web K: клик тоже циклит), клик по телу —
 * прыжок к сообщению + вспышка; × — открепить через диалог подтверждения
 * (unpin-dialog); кнопка
 * списка — поповер всех закрепов (Telegram — отдельная страница, Slack —
 * панель; у нас поповер у бара + секция «Закреплённые» в панели беседы).
 * АВТОРОТАЦИИ НЕТ (её нет ни у кого из референсов). Нет закрепов — бар
 * не монтируется (место не резервируется, появление анимацией высоты).
 * Порядок — по pinnedAt (свежий первым); удаление закреплённого спускает
 * бар на предыдущий (эталон bugs.telegram.org/c/4340).
 */
export function PinBar({
  conversationId,
  onOpenThread,
}: {
  conversationId: string;
  /** Закреп-ответ из треда канала: клик открывает окно треда. */
  onOpenThread?: (rootId: string) => void;
}) {
  const { data: pins } = usePins(conversationId);
  const ask = useUnpinDialog((s) => s.ask);
  const [index, setIndex] = useState(0);

  const count = pins?.length ?? 0;
  // Список изменился (новый закреп/снятие) — возврат к свежему (index 0).
  useEffect(() => {
    setIndex(0);
  }, [count]);

  if (!pins || count === 0) return null;
  const current = Math.min(index, count - 1);
  const pin = pins[current];
  if (!pin) return null;
  const { message } = pin;

  function jump() {
    if (message.threadRootId && onOpenThread) {
      onOpenThread(message.threadRootId);
    }
    useJumpStore.getState().request(conversationId, message.id, message.threadRootId);
  }

  return (
    <div
      data-testid="pin-bar"
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
    >
      <Pin className="size-4 shrink-0 text-info" strokeWidth={1.75} />
      <button
        type="button"
        onClick={jump}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md py-1 text-left transition-colors hover:bg-accent/40"
      >
        <span className="flex max-w-full items-baseline gap-1.5">
          {/* Метка не сжимается (в узкой колонке при открытом треде иначе
              схлопывалась до «…» — баг скриншот-прогона 24.09); сжимается
              имя автора. */}
          <span className="shrink-0 text-xs font-semibold text-foreground">
            {ui.chat.pinnedBarLabel}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {message.deletedAt ? '' : withoutPatronymic(message.author.displayName)}
          </span>
        </span>
        <span className="max-w-full truncate text-xs text-muted-foreground">
          {pinSnippet(
            message.text,
            message.attachments[0]?.kind ?? null,
            message.deletedAt !== null,
          )}
        </span>
      </button>
      {count > 1 ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
            {current + 1} / {count}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={ui.chat.pinPrev}
            onClick={() => setIndex((i) => (i - 1 + count) % count)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={ui.chat.pinNext}
            onClick={() => setIndex((i) => (i + 1) % count)}
          >
            <ChevronDown />
          </Button>
        </span>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            aria-label={ui.chat.pinnedSection}
            title={ui.chat.pinnedSection}
          >
            <LayoutList />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-1.5">
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {pins.map((p) => (
              <li key={p.message.id}>
                <span className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-accent/40">
                  <button
                    type="button"
                    onClick={() => {
                      if (p.message.threadRootId && onOpenThread)
                        onOpenThread(p.message.threadRootId);
                      useJumpStore
                        .getState()
                        .request(conversationId, p.message.id, p.message.threadRootId);
                    }}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                    title={ui.chat.pinGoTo}
                  >
                    <span className="flex max-w-full items-baseline gap-1.5">
                      <span className="truncate text-xs font-semibold">
                        {withoutPatronymic(p.message.author.displayName)}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {formatTime(p.pinnedAt)}
                      </span>
                    </span>
                    <span className="max-w-full truncate text-xs text-muted-foreground">
                      {pinSnippet(
                        p.message.text,
                        p.message.attachments[0]?.kind ?? null,
                        p.message.deletedAt !== null,
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => ask(conversationId, p.message.id)}
                    aria-label={ui.chat.unpin}
                    title={ui.chat.unpin}
                    className={cn(
                      'shrink-0 rounded-md p-1 text-muted-foreground transition-colors',
                      'hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <PinOff className="size-3.5" strokeWidth={1.75} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground"
        aria-label={ui.chat.unpin}
        title={ui.chat.unpin}
        onClick={() => ask(conversationId, message.id)}
      >
        <PinOff />
      </Button>
    </div>
  );
}
