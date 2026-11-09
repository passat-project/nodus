import { ArrowLeft, Megaphone, Paperclip } from 'lucide-react';
import { useState } from 'react';
import type { ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { formatDate, plural, withoutPatronymic } from '../lib/format.js';
import { PersonAvatar } from '../ui/person-avatar.js';
import { useConversationMessages } from './chat-queries.js';
import { conversationTitle } from './conversations.js';

/**
 * Второй уровень диалога пересылки — «куда поместить» внутри канала (A7,
 * #87): «В ленту — новым постом» + недавние обсуждения. Выдержка корня
 * (автор + дата + 1–2 строки + счётчик ответов + значки вложений) заменяет
 * имя топика Telegram Forums — пост узнаётся теми же признаками, что и в
 * ленте; поиск по тексту постов.
 */
export function ThreadLevel({
  conversation,
  meId,
  onBack,
  onPick,
}: {
  conversation: ConversationListItem;
  meId?: string | null;
  onBack: () => void;
  onPick: (threadRootId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { data } = useConversationMessages(conversation.id);
  const roots = (data?.items ?? [])
    .filter((m) => m.threadRootId === null && m.deletedAt === null)
    .filter((m) => m.text.toLowerCase().includes(query.trim().toLowerCase()))
    .toReversed();
  return (
    <>
      {/* pr-8: запас под абсолютный крестик DialogContent — метка шага
          «Куда поместить» не накладывается на него (баг-вердикт 24.09). */}
      <span className="flex h-8 items-center gap-2 pr-8">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={ui.chat.forwardBack}
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <DialogTitle className="min-w-0 truncate text-base font-semibold text-foreground">
          {conversationTitle(conversation, meId)}
        </DialogTitle>
        <NodeLabel label={ui.chat.forwardChannelStep} className="ml-auto shrink-0" />
      </span>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ui.chat.forwardThreadSearchPlaceholder}
        className="mt-3 rounded-lg border-input"
        autoFocus
      />
      {/* Зона списка — flex-1 фиксированного по высоте диалога: окно не
          прыгает при смене шага/фильтра (канон 24.09, research wix#3493). */}
      <ul className="-mx-1 mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <li>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent/40"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft/60 text-info">
              <Megaphone className="size-4" strokeWidth={1.75} />
            </span>
            <span className="text-sm font-medium">{ui.chat.forwardToFeed}</span>
          </button>
        </li>
        <li className="px-2 pt-2">
          <NodeLabel label={ui.chat.forwardRecentThreads} />
        </li>
        {roots.map((root) => (
          <li key={root.id}>
            <button
              type="button"
              onClick={() => onPick(root.id)}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/40"
            >
              <PersonAvatar name={root.author.displayName} className="mt-0.5 size-8 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">
                    {withoutPatronymic(root.author.displayName)}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {formatDate(root.createdAt)}
                  </span>
                  {root.attachments.length > 0 ? (
                    <Paperclip
                      className="size-3 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                  ) : null}
                  {root.threadRepliesCount > 0 ? (
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {root.threadRepliesCount}{' '}
                      {plural(root.threadRepliesCount, [
                        ui.chat.repliesOne,
                        ui.chat.repliesFew,
                        ui.chat.repliesMany,
                      ])}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
                  {root.text}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
