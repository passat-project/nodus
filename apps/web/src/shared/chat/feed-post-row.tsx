import { memo } from 'react';
import { MessageScrollerItem } from '@nodus/ui/components/message-scroller';
import type { ChatMessage } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { MessageMenu } from './message-menu.js';
import { MessageRow } from './message-row.js';
import { PostCard } from './post-card.js';

/**
 * Строка поста ленты канала — анатомия одного поста вне потока ленты (I5,
 * #129): скролл-якорь примитива + селект-обёртка + контекстное меню (у
 * живых) + карточка поста или надгробие. Данные треда (счётчик ответов,
 * участники, «есть новые») — per-message, считает родитель по repliesByRoot
 * и передаёт готовыми (баг-вердикт 30.09: ответ на второй пост серии не
 * должен показывать счётчик первого).
 */
export const FeedPostRow = memo(function FeedPostRow({
  message,
  mine,
  atEnd,
  showName,
  replies,
  threadUnread,
  selectionActive,
  selected,
  onToggle,
  conversationId,
  scope,
  onOpenThread,
  onCloseThread,
  openThreadId,
  getSelectedMessages,
  style,
}: {
  message: ChatMessage;
  mine: boolean;
  /** «По обе стороны» (#151): своя серия прижимается вправо. */
  atEnd: boolean;
  showName: boolean;
  replies: ChatMessage[];
  threadUnread: boolean;
  selectionActive: boolean;
  selected: boolean;
  onToggle: (shiftKey: boolean) => void;
  conversationId: string;
  scope: string;
  onOpenThread: (rootId: string) => void;
  /** Закрыть открытое окно треда (тумблер полосы «Обсудить», #1021). */
  onCloseThread: () => void;
  /** Какой тред канала сейчас открыт (для состояния полосы). */
  openThreadId: string | null;
  getSelectedMessages: () => ChatMessage[];
  style?: React.CSSProperties;
}) {
  const repliesCount = message.threadRepliesCount || replies.length;
  const participants = [...new Map(replies.map((r) => [r.author.id, r.author])).values()];
  const last = replies[replies.length - 1];
  const deleted = Boolean(message.deletedAt);
  const threadOpen = openThreadId === message.id;
  const toggleThread = () => (threadOpen ? onCloseThread() : onOpenThread(message.id));

  return (
    <MessageScrollerItem messageId={message.id} style={style}>
      <div className={cn('flex w-full min-w-0', atEnd ? 'justify-end' : 'justify-start')}>
        <MessageRow
          messageId={message.id}
          selectionKey={message.clientMessageId}
          selectable={selectionActive && !deleted}
          selected={selected}
          onToggle={onToggle}
        >
          {deleted ? (
            <PostCard
              message={message}
              mine={mine}
              atEnd={atEnd}
              showName={showName}
              repliesCount={repliesCount}
              participants={participants}
              lastReplyAt={last?.createdAt ?? null}
              threadUnread={threadUnread}
              reactionsHidden
              threadOpen={threadOpen}
              onToggleThread={toggleThread}
            />
          ) : (
            <MessageMenu
              message={message}
              mine={mine}
              conversationId={conversationId}
              scope={scope}
              replyMode="thread"
              onOpenThread={onOpenThread}
              messagesOfSelection={getSelectedMessages}
            >
              <PostCard
                message={message}
                mine={mine}
                atEnd={atEnd}
                showName={showName}
                repliesCount={repliesCount}
                participants={participants}
                lastReplyAt={last?.createdAt ?? null}
                threadUnread={threadUnread}
                reactionsHidden={selectionActive}
                threadOpen={threadOpen}
                onToggleThread={toggleThread}
              />
            </MessageMenu>
          )}
        </MessageRow>
      </div>
    </MessageScrollerItem>
  );
});
