import { Check, History, Plus } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useAssistantSessions } from '../api/assistant-api.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { AssistantGlyph } from './assistant-feed.js';

function sessionTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Пикер сессий из шапки диалога (#895): сессии с сервера, текущая отмечена,
 * строки — глиф + название + время, сверху тихое «Новый диалог». Список НЕ
 * показывается при открытии панели: сразу прошлый чат.
 */
export function AssistantSessionPicker({ onNewChat }: { onNewChat: () => void }) {
  const [open, setOpen] = useState(false);
  const sessions = useAssistantSessions().data?.items ?? [];
  const activeId = useAssistantStore((state) => state.activeId);
  const setActive = useAssistantStore((state) => state.setActive);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={ui.assistant.sessionsPick}
          title={ui.assistant.sessionsPick}
        >
          <History className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
          {ui.assistant.newChat}
        </button>
        <div
          className="flex max-h-[var(--radix-popover-content-available-height)] flex-col gap-0.5 overflow-y-auto pt-1"
          data-no-scrollbar
        >
          {sessions.length === 0 ? (
            <span className="px-1.5 py-1.5 text-label text-muted-foreground">
              {ui.assistant.emptySession}
            </span>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  setActive(session.id);
                  setOpen(false);
                }}
                title={session.title}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-accent',
                  session.id === activeId && 'bg-accent',
                )}
              >
                <AssistantGlyph className="size-7" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-label text-foreground">{session.title}</span>
                  <span className="font-mono text-badge text-muted-foreground tabular-nums">
                    {sessionTime(session.lastMessageAt ?? session.createdAt)}
                  </span>
                </span>
                {session.id === activeId ? (
                  <Check className="size-3.5 shrink-0 text-primary" />
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
