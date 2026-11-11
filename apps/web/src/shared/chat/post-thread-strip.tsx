import { ArrowRight } from 'lucide-react';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatTime, plural } from '../lib/format.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { messageSurface } from './message-surface.js';

/** «N ответов» — полоса поста (ед./мн. по правилам ru). */
export function repliesLabel(count: number): string {
  return `${count} ${plural(count, [ui.chat.repliesOne, ui.chat.repliesFew, ui.chat.repliesMany])}`;
}

/**
 * Нижняя полоса обсуждения поста канала (в живом посте — хвост карточки, в
 * надгробии — содержимое кнопки): участники треда, счётчик с точкой «есть
 * новые», время последнего ответа. Вынесено из post-card (I5): потребляют
 * живой пост и надгробие.
 */
export function ThreadStrip({
  surface,
  participants,
  repliesCount,
  lastReplyAt,
  threadUnread,
}: {
  surface: ReturnType<typeof messageSurface>;
  participants: ChatMessage['author'][];
  repliesCount: number;
  lastReplyAt: string | null;
  threadUnread: boolean;
}) {
  return (
    <>
      {participants.length > 0 ? (
        <span className="flex shrink-0 -space-x-1.5">
          {participants.slice(0, 3).map((p) => (
            <PersonAvatar
              key={p.id}
              name={p.displayName}
              avatarUrl={p.avatarUrl}
              decorative
              className={cn('size-5 ring-2', surface.ring)}
            />
          ))}
        </span>
      ) : null}
      {/* Счётчик — ТОЛЬКО при ответах (баг-вердикт 30.09: «0 ответов» в пустой
          полосе — мусор; раньше было пусто, остаётся пусто). */}
      {repliesCount > 0 ? (
        <span
          className={cn(
            'flex items-center gap-1.5 font-mono text-label-sm tabular-nums',
            // Тон счётчика — тон поверхности (AA на любой заливке, валидатор #127).
            surface.stripText,
          )}
        >
          {threadUnread ? (
            <span
              aria-label={ui.chat.threadUnreadHint}
              className={cn('size-1.5 shrink-0 rounded-full', surface.accentBg)}
            />
          ) : null}
          {repliesLabel(repliesCount)}
          {lastReplyAt ? ` · ${formatTime(lastReplyAt)}` : ''}
        </span>
      ) : null}
    </>
  );
}

/** Правый конец полосы: «Обсудить →» (тон поверхности, #127). */
export function ThreadStripEnter({ surface }: { surface: ReturnType<typeof messageSurface> }) {
  return (
    <span
      className={cn('ml-auto inline-flex items-center gap-1 text-xs font-medium', surface.linkText)}
    >
      {ui.chat.toThread}
      <ArrowRight className="size-3" strokeWidth={1.75} />
    </span>
  );
}
