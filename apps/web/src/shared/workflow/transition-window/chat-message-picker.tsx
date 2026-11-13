import { useMemo, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { Input } from '@nodus/ui/components/input';

import { useConversationMessages } from '../../chat/chat-queries.js';
import { withoutPatronymic } from '../../lib/format.js';

/**
 * «Сообщения из чата как итог» (#380): список сообщений беседы задачи с
 * флажками и поиском по загруженным. Блоки перехода (`task_transition`) и
 * удалённые не показываются — отчётом может быть обычное сообщение.
 */
export function ChatMessagePicker({
  conversationId,
  selected,
  onToggle,
}: {
  conversationId: string;
  selected: readonly string[];
  onToggle: (messageId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useConversationMessages(conversationId);
  const selectedSet = new Set(selected);
  const messages = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.items ?? [])
      .filter(
        (m) =>
          !m.deletedAt &&
          m.kind !== 'task_transition' &&
          m.kind !== 'letter_transition' &&
          m.kind !== 'task_press',
      )
      .filter(
        (m) =>
          needle.length === 0 ||
          m.text.toLowerCase().includes(needle) ||
          m.author.displayName.toLowerCase().includes(needle),
      )
      .slice()
      .reverse();
  }, [data, search]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={ui.tasks.window.searchMessages}
        aria-label={ui.tasks.window.searchMessages}
        className="h-8 text-sm"
      />
      <div className="flex h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
        {messages.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {isLoading ? ui.common.search : ui.tasks.window.messagesEmpty}
          </p>
        ) : (
          messages.map((message) => (
            <label
              key={message.id}
              className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50"
            >
              <Checkbox
                className="mt-0.5"
                checked={selectedSet.has(message.id)}
                onCheckedChange={() => onToggle(message.id)}
                aria-label={message.text.slice(0, 60) || ui.tasks.window.messagesLabel}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">
                  {withoutPatronymic(message.author.displayName)}
                </span>
                <span className="line-clamp-2 min-w-0 text-xs wrap-anywhere">
                  {message.text || '—'}
                </span>
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
