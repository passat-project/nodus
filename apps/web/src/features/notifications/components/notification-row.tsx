import { BellRing, MessageSquare, MessageSquareReply, Zap } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Notification, NotificationPriority } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { MentionSnippet } from '../../../shared/chat/mention-chip.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { formatListTimestamp } from '../../../shared/lib/format.js';
import { formatCount, type NotificationGroup } from '../model/group-notifications.js';
import { rowSourceRect } from '../model/open-notification.js';
import type { SourceRect } from '../../../app/shell/slider-panel.js';

/** Метка приоритета строки (E11: контраст в обеих темах — семантические токены). */
const PRIORITY_CLASS: Record<NotificationPriority, string> = {
  urgent: 'bg-danger/15 text-danger',
  high: 'bg-info/15 text-info',
  medium: 'bg-warning/15 text-warning-foreground text-warning',
  low: 'bg-muted text-muted-foreground',
};

const PRIORITY_LABEL: Record<NotificationPriority, string> = {
  urgent: ui.notifications.priorityUrgent,
  high: ui.notifications.priorityHigh,
  medium: ui.notifications.priorityMedium,
  low: ui.notifications.priorityLow,
};

function PriorityMark({ priority }: { priority: NotificationPriority }) {
  const label = PRIORITY_LABEL[priority];
  return (
    <span
      className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_CLASS[priority]}`}
      title={label}
      aria-label={label}
    />
  );
}

function kindTitle(kind: Notification['kind']): string {
  return ui.notifications.kindTitles[kind];
}

/** Строка ленты: кто (аватар) · что (выжимка) · где (источник) · когда
 *  (E3) + метка приоритета; клик — сразу к источнику (Битрикс24), срочное и
 *  безисточниковое — ридер-панель (стек ADR-0009). Третья строка — только
 *  НАЗВАНИЕ беседы/обсуждения: у личных источник = сам автор, дубль имени
 *  не показываем (фидбек владельца 01.10). */
export function NotificationRow({
  group,
  onOpen,
}: {
  group: NotificationGroup;
  onOpen: (item: Notification, sourceRect?: SourceRect) => void;
}) {
  const item = group.latest;
  function handleClick(e: MouseEvent<HTMLElement>) {
    onOpen(item, rowSourceRect(e));
  }

  const where = item.conversationTitle ?? '';

  return (
    <article className="node-panel transition-colors hover:bg-accent/60">
      <button type="button" onClick={handleClick} className="block w-full p-4 text-left">
        <div className="flex items-start gap-3">
          <PersonAvatar name={item.actor?.displayName ?? 'N'} className="size-9" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <PriorityMark priority={item.priority} />
              <span className="truncate text-sm font-semibold">
                {item.actor?.displayName ?? kindTitle(item.kind)}
              </span>
              {group.count > 1 && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  +{formatCount(group.count - 1)}
                </span>
              )}
              <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
                {formatListTimestamp(item.createdAt)}
              </span>
            </div>
            <div className="mt-0.5 truncate text-sm text-foreground/90">
              {kindTitle(item.kind)}
              {item.preview ? ' · ' : ''}
              {item.preview ? <MentionSnippet text={item.preview} /> : null}
            </div>
            {where.length > 0 && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {item.kind === 'chat.thread_reply' ? (
                  <MessageSquareReply className="size-3" strokeWidth={1.75} />
                ) : item.priority === 'urgent' ? (
                  <Zap className="size-3" strokeWidth={1.75} fill="currentColor" />
                ) : item.priority === 'medium' ? (
                  <BellRing className="size-3" strokeWidth={1.75} />
                ) : (
                  <MessageSquare className="size-3" strokeWidth={1.75} />
                )}
                <span className="truncate">{where}</span>
              </div>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}

/** Строка в поповере колокольчика — плотнее, без источника. */
export function NotificationRowCompact({
  item,
  onOpen,
}: {
  item: Notification;
  onOpen: (item: Notification, sourceRect?: SourceRect) => void;
}) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    onOpen(item, rowSourceRect(e));
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
    >
      <PersonAvatar name={item.actor?.displayName ?? 'N'} className="size-7" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {item.actor?.displayName ?? ui.notifications.bellLabel}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {ui.notifications.kindTitles[item.kind]}
          {item.preview ? ' · ' : ''}
          {item.preview ? <MentionSnippet text={item.preview} /> : null}
        </span>
      </span>
      <PriorityMark priority={item.priority} />
    </button>
  );
}
