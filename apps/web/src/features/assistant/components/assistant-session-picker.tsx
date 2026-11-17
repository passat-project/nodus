import { Check, History, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import {
  useAssistantSessions,
  useDeleteAssistantSession,
  useRenameAssistantSession,
} from '../api/assistant-api.js';
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
 *
 * Команды строки (18.11): карандаш — переименовать (инлайн-поле, Enter/blur —
 * сохранить, Esc — отмена), крестик — удалить диалог (каскад на сервере).
 * Появляются по ховеру/фокусу, как инлайн-контролы канона таблиц.
 */
export function AssistantSessionPicker({ onNewChat }: { onNewChat: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const sessions = useAssistantSessions().data?.items ?? [];
  const activeId = useAssistantStore((state) => state.activeId);
  const setActive = useAssistantStore((state) => state.setActive);
  const rename = useRenameAssistantSession();
  const remove = useDeleteAssistantSession();

  function startEdit(id: string, title: string) {
    setEditing(id);
    setDraft(title);
  }
  function saveEdit(id: string, fallback: string) {
    const title = draft.trim();
    setEditing(null);
    if (title && title !== fallback) {
      rename.mutate({ id, title }, { onError: () => toast.error(ui.assistant.sessionActionError) });
    }
  }
  function deleteSession(id: string) {
    if (id === activeId) onNewChat();
    remove.mutate(id, { onError: () => toast.error(ui.assistant.sessionActionError) });
  }

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
              <div
                key={session.id}
                className={cn(
                  'group flex w-full items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent',
                  session.id === activeId && 'bg-accent',
                )}
              >
                {editing === session.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => saveEdit(session.id, session.title)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveEdit(session.id, session.title);
                      if (event.key === 'Escape') setEditing(null);
                    }}
                    aria-label={ui.assistant.sessionRename}
                    className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-label text-foreground focus-visible:border-ring focus-visible:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActive(session.id);
                      setOpen(false);
                    }}
                    title={session.title}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
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
                )}
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={ui.assistant.sessionRename}
                    title={ui.assistant.sessionRename}
                    onClick={() => startEdit(session.id, session.title)}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    aria-label={ui.assistant.sessionDelete}
                    title={ui.assistant.sessionDelete}
                    onClick={() => deleteSession(session.id)}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
