import { Bot } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../../../shared/auth-store.js';
import { ChatMessageItem } from '../../../shared/chat/chat-message.js';
import { DayChip } from '../../../shared/chat/day-chip.js';
import {
  buildMessageRuns,
  formatDayLabel,
  startsNewDay,
} from '../../../shared/chat/message-groups.js';
import { MessageRunView } from '../../../shared/chat/message-run.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { usePersonAvatarUrl } from '../../../shared/ui/use-person-avatar-url.js';
import { toChatMessage } from '../model/assistant-messages.js';
import type { AssistantMessage } from '../model/assistant-store.js';

/** Глиф ассистента — РОБОТ (не Sparkles: тот занят «Что нового», вердикт
 *  владельца 16.11.2026): индиго-подложка единственного акцента действия;
 *  в ленте круглый, как аватары серии, в списках — плашка. */
export function AssistantGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary',
        className,
      )}
    >
      <Bot className="size-4" />
    </span>
  );
}

function TypingDots() {
  return (
    <span
      role="status"
      aria-label={ui.assistant.thinking}
      className="flex items-center gap-1 px-1 py-1.5"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 200}ms` }}
        />
      ))}
    </span>
  );
}

/** Лента диалога — КАНОН МЕССЕНДЖЕРА: серии одного автора (MessageRunView),
 *  пузыри bubble-* с хвостами и метой времени (ChatMessageItem), чип дня.
 *  Аватар ассистента — глиф (renderAvatar), свои — графитовый PersonAvatar.
 *  Реакции/квитанции выключены: диалог с ИИ, не беседа сотрудников. */
export function AssistantFeed({
  messages,
  thinking,
}: {
  messages: AssistantMessage[];
  thinking: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Автодогон ТОЛЬКО у низа (канон чатов): читающего выше не выдёргивать
  // вниз каждым тиком стриминга (замечание валидации 16.11.2026).
  const atBottomRef = useRef(true);
  const me = useAuthStore((s) => s.user);
  const myAvatarUrl = usePersonAvatarUrl(me?.id);
  const meRef = me ? { id: me.id, displayName: me.displayName, avatarUrl: myAvatarUrl } : null;

  const runs = buildMessageRuns(
    messages.map((m) => toChatMessage(m, meRef)),
    me?.id,
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  return (
    // Зону с обоями (chat-zone + chat-wallpaper) несёт обёртка тела — она
    // продолжается под композером; здесь только скролл ленты.
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
    >
      <div className="flex flex-col gap-3">
        {runs.map((run, i) => {
          const prev = runs[i - 1];
          const newDay = prev ? startsNewDay(prev.last, run.first) : true;
          return (
            <div key={run.first.id} className="flex flex-col gap-3">
              {newDay ? <DayChip label={formatDayLabel(run.first.createdAt)} /> : null}
              <MessageRunView
                run={run}
                showName={false}
                renderAvatar={(r) =>
                  r.mine ? (
                    <PersonAvatar
                      name={me?.displayName ?? ui.assistant.meFallback}
                      avatarUrl={myAvatarUrl}
                      className="size-7"
                    />
                  ) : (
                    <AssistantGlyph className="size-7 rounded-full" />
                  )
                }
                renderItem={(m, attrs) => (
                  <div style={attrs.style} className="min-w-0">
                    <ChatMessageItem
                      message={m}
                      mine={run.mine}
                      avatarSlot="none"
                      tail={attrs.tail}
                      reactionsHidden
                      receiptsHidden
                    />
                  </div>
                )}
              />
            </div>
          );
        })}
        {thinking ? (
          <div className="flex items-end gap-2">
            <AssistantGlyph className="size-7 rounded-full" />
            <div className="rounded-2xl bg-bubble-in px-2.5">
              <TypingDots />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
