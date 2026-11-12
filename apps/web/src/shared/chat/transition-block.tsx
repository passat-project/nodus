import { CornerDownRight } from 'lucide-react';
import type { ChatMessage, TaskTransitionBlock } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatDateTime, shortPersonName } from '../lib/format.js';
import { personTone } from '../ui/person-tone.js';
import { StageChip } from '../ui/stage-chip.js';
import { MessageAuthorAvatar } from './message-avatar.js';
import { LinkifiedText } from './message-text.js';

/** Склонение по числу (файл/файла/файлов, сообщение/…). */
function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Блок перехода в ленте чата (#380): «↪ Приостановить · В работе →
 * Приостановлена», подпись и текст причины, строка «Итог обновлён · N
 * файлов». Компактный, без пузыря: это запись журнала, а не реплика
 * (задел #313 — системные строки). Виден во всех хостах единого движка.
 * Оба вида: задача (итог, #380) и письмо (#55 Р10 — цель чипом цвета
 * стадии: «Ошибочно зарегистрировано» видно издалека).
 */
export function TransitionBlock({
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
  if (!block) return null;
  return (
    <div className={cn('flex w-full min-w-0 gap-2 py-0.5', mine && 'flex-row-reverse')}>
      {avatarSlot === 'avatar' ? (
        <MessageAuthorAvatar
          author={message.author}
          mine={mine}
          className="mt-auto shrink-0"
          avatarClassName="size-8"
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
            <CornerDownRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="font-medium text-foreground">{block.transitionName}</span>
            <span aria-hidden>·</span>
            <span>
              {block.fromStageName} {ui.chat.transitionBlock.arrow}
              {block.kind === 'task_transition' ? ` ${block.toStageName}` : null}
            </span>
            {block.kind === 'letter_transition' ? (
              <StageChip name={block.toStageName} color={block.toStageColor} />
            ) : null}
          </p>
          {message.text ? (
            <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
              {block.commentLabel ? (
                <span className="text-muted-foreground">{block.commentLabel}: </span>
              ) : null}
              <LinkifiedText text={message.text} />
            </p>
          ) : null}
          {block.kind === 'task_transition' && block.result ? (
            <ResultLine result={block.result} />
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {shortPersonName(message.author.displayName)} · {formatDateTime(message.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ResultLine({ result }: { result: NonNullable<TaskTransitionBlock['result']> }) {
  const parts: string[] = [];
  if (result.fileCount > 0) {
    parts.push(`${result.fileCount} ${plural(result.fileCount, ui.chat.transitionBlock.files)}`);
  }
  if (result.messageCount > 0) {
    parts.push(
      `${result.messageCount} ${plural(result.messageCount, ui.chat.transitionBlock.messages)}`,
    );
  }
  if (parts.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {ui.chat.transitionBlock.resultUpdated} · {parts.join(' · ')}
    </p>
  );
}
