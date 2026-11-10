import { CornerDownRight, Undo2 } from 'lucide-react';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatDateTime, shortPersonName } from '../lib/format.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { personTone } from '../ui/person-tone.js';
import { LinkifiedText } from './message-text.js';

/** Склонение по числу (файл/файла/файлов, сотрудник/…). */
function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Блок отметки сбора в ленте чата (#434): «↪ Завершить · сдал результат» с
 * текстом результата или «↪ Завершить · вернул на доработку · 2 сотрудника»
 * с причиной. Запись журнала, не пузырь; пишется только для адресных
 * раундов — «Все сотрудники» блоков не создаёт (анти-спам).
 */
export function PressBlock({
  message,
  mine,
  showName,
  avatarSlot,
}: {
  message: ChatMessage;
  mine: boolean;
  showName: boolean;
  avatarSlot: 'avatar' | 'none';
}) {
  const block = message.block;
  if (!block || block.kind !== 'task_press') return null;
  return (
    <div className={cn('flex w-full min-w-0 gap-2 py-0.5', mine && 'flex-row-reverse')}>
      {avatarSlot === 'avatar' ? (
        <PersonAvatar
          name={message.author.displayName}
          avatarUrl={message.author.avatarUrl}
          className="mt-auto size-8 shrink-0"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {showName ? (
          <span
            className={cn(
              'flex min-w-0 items-baseline gap-1 text-sm leading-[19px] font-semibold',
              personTone(message.author.id),
            )}
          >
            <span className="truncate">{shortPersonName(message.author.displayName)}</span>
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {block.state === 'returned' ? (
              <Undo2 className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <CornerDownRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            )}
            <span className="font-medium text-foreground">{block.transitionName}</span>
            <span aria-hidden>·</span>
            <span>
              {block.state === 'returned'
                ? ui.chat.pressBlock.returned
                : ui.chat.pressBlock.submitted}
            </span>
            {block.state === 'returned' && block.returnCount ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {block.returnCount} {plural(block.returnCount, ui.chat.pressBlock.returnedPeople)}
                </span>
              </>
            ) : null}
          </p>
          {message.text ? (
            <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
              {block.state === 'returned' ? (
                <span className="text-muted-foreground">{ui.chat.pressBlock.reason}: </span>
              ) : null}
              <LinkifiedText text={message.text} />
            </p>
          ) : null}
          {block.state === 'pressed' && block.fileCount ? (
            <p className="text-xs text-muted-foreground">
              {block.fileCount} {plural(block.fileCount, ui.chat.transitionBlock.files)}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {shortPersonName(message.author.displayName)} · {formatDateTime(message.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
