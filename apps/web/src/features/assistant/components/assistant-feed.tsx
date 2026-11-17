import { Bot, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  ui,
  type AssistantAction,
  type AssistantMessage,
  type AssistantToolCall,
} from '@nodus/contracts';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@nodus/ui/components/message-scroller';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../../../shared/auth-store.js';
import { ChatMessageItem } from '../../../shared/chat/chat-message.js';
import { ScrollEndResponder } from '../../../shared/chat/scroll-end-responder.js';
import { useIncomingFollow } from '../../../shared/chat/use-incoming-follow.js';
import { AssistantActionCard } from './assistant-action-card.js';
import { AssistantMarkdown } from './assistant-markdown.js';
import { AssistantMessageMenu } from './assistant-message-menu.js';
import { DayChip } from '../../../shared/chat/day-chip.js';
import {
  buildMessageRuns,
  formatDayLabel,
  type MessageRun,
} from '../../../shared/chat/message-groups.js';
import { MessageRunView } from '../../../shared/chat/message-run.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { usePersonAvatarUrl } from '../../../shared/ui/use-person-avatar-url.js';
import type { AssistantLiveRun } from '../model/assistant-store.js';
import { toChatMessage } from '../model/assistant-messages.js';
import { ASSISTANT_SCROLL_SCOPE } from '../model/assistant-scroll.js';
import { useStickyBottom } from '../model/use-sticky-bottom.js';
import { AssistantEntityLinks, AssistantToolRows } from './assistant-tool-rows.js';

const strings = ui.assistant;

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

/** Точки «думает»: до первого токена (модель может молчать несколько секунд). */
function TypingDots() {
  return (
    <span
      role="status"
      aria-label={strings.thinking}
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

/**
 * Размышления модели — СКРЫТЫЙ блок с шевроном (требование владельца
 * 17.11.2026): по умолчанию свёрнут, чтобы не мешать читать ответ; при
 * желании сотрудник раскрывает и видит «полутоны» решения. Живёт ВНУТРИ
 * хода ассистента, над пузырём — служебная строка, не ответ.
 */
export function AssistantReasoning({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Раскрытые размышления следуют за потоком, пока сотрудник не закрыл блок.
  useEffect(() => {
    const el = ref.current?.querySelector('[data-reasoning-body]');
    if (el && ref.current?.open) el.scrollTop = el.scrollHeight;
  }, [reasoning]);
  return (
    <details ref={ref} className="group mb-1.5 rounded-lg bg-muted/40 px-2 py-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-label text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        {strings.reasoningTitle}
        {streaming ? <span className="text-badge opacity-70">•</span> : null}
      </summary>
      <div
        data-reasoning-body
        className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap px-4 text-badge leading-relaxed text-muted-foreground"
      >
        {reasoning}
      </div>
    </details>
  );
}

/** Сегмент ленты: серия реплик одного автора + вводная часть хода. */
interface Segment {
  run: MessageRun;
  tools: AssistantToolCall[];
  /** Карточки действий хода (Ф2): подтверждение/результат записи. */
  actions: AssistantAction[];
  reasoning: string | null;
  streaming: boolean;
  errorCode: string | null;
  /** Текст для пузыря: упавший прогон без текста показывает только строку
   *  ошибки с «Повторить», а не пустой пузырь с временем. */
  visible: boolean;
  showDay: boolean;
}

/** Автор-сотрудник для пузырей «справа»: id нужен для группировки. */
function meOf(meId: string | undefined) {
  return meId ? ({ id: meId, displayName: ui.common.you, avatarUrl: null } as const) : null;
}

/** Разбиение ленты на сегменты: ассистентский ход с вызовами/размышлениями
 *  начинается с вводного блока (вызовы + шеврон размышлений), затем пузыри. */
function buildSegments(messages: readonly AssistantMessage[], meId: string | undefined): Segment[] {
  const groups: AssistantMessage[][] = [];
  for (const message of messages) {
    const preamble =
      message.role === 'assistant' && (message.toolCalls.length > 0 || Boolean(message.reasoning));
    const current = groups.at(-1);
    const sameAuthor = current?.at(-1)?.role === message.role;
    if (!current || !sameAuthor || preamble) groups.push([message]);
    else current.push(message);
  }
  return groups.map((group, index) => {
    const runs = buildMessageRuns(
      group.map((message) => toChatMessage(message, meOf(meId))),
      meId,
    );
    const first = group[0]!;
    const previous = groups[index - 1]?.at(-1);
    return {
      run: runs[0]!,
      tools: first.role === 'assistant' ? first.toolCalls : [],
      actions: group.flatMap((message) => message.actions),
      reasoning: first.role === 'assistant' ? first.reasoning : null,
      streaming: group.some((message) => message.streaming),
      errorCode: group.find((message) => message.errorCode)?.errorCode ?? null,
      visible: group.some((message) => message.text.trim().length > 0),
      showDay: previous
        ? new Date(previous.createdAt).toDateString() !== new Date(first.createdAt).toDateString()
        : true,
    };
  });
}

/**
 * Лента диалога (#895): канон мессенджера (серии, пузыри, чип дня) + строки
 * вызовов инструментов и скрываемые размышления модели внутри хода.
 */
export function AssistantFeed({
  messages,
  live,
  activeSessionId,
  onRetry,
}: {
  messages: readonly AssistantMessage[];
  live: AssistantLiveRun | null;
  activeSessionId: string | null;
  onRetry: () => void;
}) {
  // Скролл — ТОТ ЖЕ примитив, что у мессенджера (канон лент): догон
  // входящих/стрима, pre-paint компенсация роста и «у низа» решаются его
  // машиной состояний, а не самодельными эффектами. Своя отправка просит
  // догон через scroll-end-store (как композер чата).
  const viewportRef = useRef<HTMLDivElement>(null);
  useStickyBottom(viewportRef);
  const me = useAuthStore((state) => state.user);
  const myAvatarUrl = usePersonAvatarUrl(me?.id);
  const showLive = Boolean(live && live.sessionId === activeSessionId);
  const segments = buildSegments(messages, me?.id);
  // Догон смотрит только на «последняя строка — не моя»: полная форма
  // ChatMessage здесь не нужна (id + автор).
  const followItems = messages.map((message) => ({
    id: message.id,
    author: { id: message.role === 'user' ? (me?.id ?? 'me') : 'assistant' },
  }));
  useIncomingFollow({
    scope: ASSISTANT_SCROLL_SCOPE,
    items: followItems,
    meId: me?.id,
    viewportRef,
    enabled: true,
  });

  return (
    <MessageScrollerProvider autoScroll>
      <ScrollEndResponder scope={ASSISTANT_SCROLL_SCOPE} />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport ref={viewportRef}>
          <MessageScrollerContent className="gap-3 px-3 py-3">
            {segments.map((segment) => (
              <div key={segment.run.first.id} className="flex flex-col gap-1.5">
                {segment.showDay ? (
                  <DayChip label={formatDayLabel(segment.run.first.createdAt)} />
                ) : null}
                {segment.tools.length > 0 ? (
                  <div className="pl-9">
                    <AssistantToolRows tools={segment.tools} />
                  </div>
                ) : null}
                {segment.reasoning ? (
                  <div className="pl-9">
                    <AssistantReasoning
                      reasoning={segment.reasoning}
                      streaming={segment.streaming}
                    />
                  </div>
                ) : null}
                {segment.actions.length > 0 ? (
                  <div className="mb-1.5 flex flex-col gap-1.5 pl-9">
                    {segment.actions.map((action) => (
                      <AssistantActionCard
                        key={action.id}
                        action={action}
                        sessionId={activeSessionId}
                      />
                    ))}
                  </div>
                ) : null}
                {segment.visible ? (
                  <MessageRunView
                    run={segment.run}
                    showName={false}
                    // Узкая колонка диалога с ИИ: сотрудник справа, агент слева
                    // (конвенция харнесов, вердикт владельца 17.11.2026).
                    align="both"
                    renderAvatar={(run) =>
                      run.mine ? (
                        <PersonAvatar
                          name={me?.displayName ?? strings.meFallback}
                          avatarUrl={myAvatarUrl}
                          className="size-7"
                        />
                      ) : (
                        <AssistantGlyph className="size-7 rounded-full" />
                      )
                    }
                    renderItem={(message, attrs) => (
                      <AssistantMessageMenu message={message}>
                        <div style={attrs.style} className="min-w-0">
                          <ChatMessageItem
                            message={message}
                            mine={segment.run.mine}
                            avatarSlot="none"
                            tail={attrs.tail}
                            reactionsHidden
                            receiptsHidden
                            align="both"
                            // Ответ агента — Markdown (ADR-0045, #897); вопрос
                            // сотрудника остаётся простым текстом, как в мессенджере.
                            textSlot={
                              segment.run.mine ? undefined : (
                                <AssistantMarkdown text={message.text} />
                              )
                            }
                          />
                        </div>
                      </AssistantMessageMenu>
                    )}
                  />
                ) : null}
                {/* Навигация — ДЕЙСТВИЕ под ответом, не строка вызова (вердикт
                владельца 17.11.2026: в туле карточку не открывают). */}
                <AssistantEntityLinks tools={segment.tools} />
                {segment.errorCode ? (
                  <div className="flex items-center gap-2 pl-9 text-label text-destructive">
                    <span>{errorText(segment.errorCode)}</span>
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <RotateCcw className="size-3" />
                      {strings.retry}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {showLive && live && live.status === 'running' ? (
              <div className="flex items-end gap-2">
                <AssistantGlyph className="size-7 rounded-full" />
                <div className="rounded-2xl bg-bubble-in px-2.5">
                  <TypingDots />
                </div>
              </div>
            ) : null}
            {showLive && live && live.status === 'cancelled' ? (
              <div className="pl-9 text-label text-muted-foreground">{strings.cancelled}</div>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/** Человеческий текст ошибки прогона по коду (UI не показывает коды). */
export function errorText(code: string): string {
  const known = strings.errors as Record<string, string | undefined>;
  return known[code] ?? strings.errors.internal;
}
