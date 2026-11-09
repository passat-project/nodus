import { Fragment, memo, useMemo, useRef } from 'react';
import { ArrowLeft, Eye, EyeOff, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { MessageGroup } from '@nodus/ui/components/message';
import { cn } from '@nodus/ui/lib/utils';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@nodus/ui/components/message-scroller';

import { useAuthStore } from '../auth-store.js';
import { useThreadMessages, useThreadStates } from './chat-queries.js';
import { useThreadTyping } from './use-thread-typing.js';
import { useWatchThread } from './conversation-actions.js';
import { ChatComposer } from './chat-composer.js';
import { ChatMessageItem } from './chat-message.js';
import { addFiles } from './composer-files.js';
import { DayChip } from './day-chip.js';
import { FeedDropzone } from './feed-dropzone.js';
import { MessageMenu } from './message-menu.js';
import { MessageRow } from './message-row.js';
import { buildMessageRuns, formatDayLabel, startsNewDay } from './message-groups.js';
import { MessageRunView } from './message-run.js';
import { selectionComposerProps, useFeedSelection } from './use-feed-selection.js';
import { useFeedViewportRead } from './use-viewport-read.js';
import { useIncomingFollow } from './use-incoming-follow.js';
import { useBoxSelection } from './use-box-selection.js';
import { ConversationViewsLine } from './views-line.js';
import { ScrollEndResponder } from './scroll-end-responder.js';
import { useHistoryLoader } from './use-history-loader.js';
import { JumpResponder } from './use-jump-responder.js';
import { useFeedSubmit } from './use-feed-submit.js';
import { useConversationHost } from './use-conversation-host.js';
/**
 * Тред канала (вердикт владельца): «провалиться внутрь — обычный чат».
 * Шапка — моно-метка «Обсуждение»; корневой пост отделён штриховой линией и
 * живёт собственной серией из одного сообщения (имя/аватар/хвостик — полный
 * набор); ответы — разговорная лента с сериями одного автора (план
 * docs/mvp/archive/chat-messages-plan.md). Композер отправляет с threadRootId.
 * Обвязка линии A (#87): селект с полосой, drop-зона, jump-резидент окна
 * треда (цитаты/закрепы-ответы), черновики/вложения per scope. Пин-бара в
 * окне треда НЕТ (v1: закрепы живут у ленты; в Telegram пины топиков свои —
 * заложено моделью threadRootId в jump/pin-контрактах).
 *
 * Два варианта шапки (окно треда, #42): 'drill' — тред ЗАМЕНИЛ ленту (узкая
 * зона, карточки): кнопка «К ленте»; 'side' — тред ПОЛНОВЫСОТНЫМ окном РАДОМ
 * с лентой (Slack-паттерн, вердикт владельца 15.09.2026).
 */
export const ThreadPane = memo(function ThreadPane({
  conversationId,
  threadRootId,
  variant = 'drill',
  barClass = 'h-12',
  onClose,
}: {
  conversationId: string;
  threadRootId: string;
  variant?: 'drill' | 'side';
  /** Высота бара треда = высота бара хоста (линии border-b продолжаются
   *  друг в друга — канон панели беседы, `headerClass`). */
  barClass?: string;
  onClose: () => void;
}) {
  const scope = `thread:${threadRootId}`;

  // Открытая беседа для гейта уведомлений (#124/#300): реестр хостов —
  // закрытие окна треда не гасит признак, пока жива лента беседы.
  useConversationHost(conversationId);
  const { data, isLoading } = useThreadMessages(conversationId, threadRootId);
  // Guardrail молнии (#177): размер беседы треда = размеру беседы.
  const me = useAuthStore((s) => s.user);
  // Наблюдение и точка «есть новые» (раунд 3): состояния трэдов текущего
  // пользователя — кнопка «Следить» и индикатор чужой печати в шапке окна.
  const { data: threadStates } = useThreadStates(conversationId);
  const watched = threadStates?.get(threadRootId)?.watched ?? false;
  const watch = useWatchThread(conversationId);
  const typingLabel = useThreadTyping(conversationId, threadRootId);

  const rawItems = data?.items;
  const items = useMemo(() => rawItems ?? [], [rawItems]);
  const root = items.find((m) => m.id === threadRootId);
  const replies = useMemo(() => items.filter((m) => m.id !== threadRootId), [items, threadRootId]);
  const runs = useMemo(() => buildMessageRuns(replies, me?.id), [replies, me?.id]);
  const rootMine = root ? root.author.id === me?.id : false;
  const selection = useFeedSelection(scope, items, me?.id);
  // Viewport окна треда — цель прыжка (scroll-jump, вердикт 25.09).
  const viewportRef = useRef<HTMLDivElement>(null);
  // Рамочное выделение (#132 р.6, модель Telegram webk — правило одного
  // прохода: окно треда — тот же хост ленты, что беседа и посты канала).
  const box = useBoxSelection({
    scope,
    viewportRef,
    selectableIds: selection.orderedIds,
    selectionActive: selection.selectionActive,
  });
  // Догон чужих ответов (#303): во всех лентах (беседа/канал/заметки) входящее
  // чужое сообщение дёргает scroll-end тем же каналом, что и своя отправка, —
  // окно трэда было единственным хостом без догона: ответ рендерился «под
  // срезом» вьюпорта и читался как «новых сообщений нет». Свои ответы догон
  // не трогает (meId) — их просит композер.
  useIncomingFollow({
    scope,
    items,
    meId: me?.id,
    viewportRef,
    enabled: true,
  });
  // Квитанции просмотров (#102 р.2): watermark беседы («увидел где угодно»)
  // И трэда (threadRootId — гасит точку «есть новые», раунд 3).
  useFeedViewportRead(conversationId, viewportRef, items, threadRootId);
  // Догрузка истории ответов при прокрутке вверх (#307): тот же sentinel,
  // кэш треда — тот же плоский (chatKeys.thread).
  const { topSentinel } = useHistoryLoader({
    conversationId,
    threadRootId,
    viewportRef,
    hasMore: (data?.nextCursor ?? null) !== null,
    items,
    enabled: !isLoading && items.length > 0,
  });

  // Протокол хоста ленты (ответы — в тред threadRootId): отправка/правка,
  // submit окна вложений, ↑-правка последнего своего — use-feed-submit.ts.
  const { handleSubmit, handleEditLast } = useFeedSubmit({
    conversationId,
    scope,
    threadRootId,
    items,
    meId: me?.id,
  });

  /** Корень треда — ВНЕ серий: полный набор (имя чужое, аватар и хвостик —
   *  свой слот, avatarSlot="avatar"); серия канона здесь не работает. */
  function renderRoot(message: (typeof items)[number]) {
    return (
      <MessageRow
        messageId={message.id}
        selectionKey={message.clientMessageId}
        selectable={selection.selectionActive && !message.deletedAt}
        selected={selection.selectedSet.has(message.clientMessageId)}
        onToggle={(shift) => selection.toggle(message.clientMessageId, shift)}
      >
        {message.deletedAt ? (
          <ChatMessageItem message={message} mine={rootMine} showName={!rootMine} />
        ) : (
          <MessageMenu
            message={message}
            mine={rootMine}
            conversationId={conversationId}
            scope={scope}
            messagesOfSelection={selection.getSelectedMessages}
          >
            <ChatMessageItem
              message={message}
              mine={rootMine}
              showName={!rootMine}
              reactionsHidden={selection.selectionActive}
            />
          </MessageMenu>
        )}
      </MessageRow>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header
        className={cn('flex shrink-0 items-center gap-2 border-b border-border px-3', barClass)}
      >
        {variant === 'drill' ? (
          <Button variant="ghost" size="icon" aria-label={ui.chat.backToFeed} onClick={onClose}>
            <ArrowLeft />
          </Button>
        ) : null}
        <NodeLabel label={ui.chat.discussion} count={replies.length} />
        {typingLabel ? (
          <span className="min-w-0 truncate text-xs italic text-info">{typingLabel}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {/* «Следить/Перестать» (раунд 3): уведомления и счётчик трэда —
              только наблюдателям (кнопка / реплай / @ / автор поста). */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-muted-foreground"
            aria-label={watched ? ui.chat.unwatchThread : ui.chat.watchThread}
            title={watched ? ui.chat.unwatchThread : ui.chat.watchThread}
            disabled={watch.isPending}
            onClick={() => watch.mutate(threadRootId)}
          >
            {watched ? (
              <EyeOff className="size-4" strokeWidth={1.75} />
            ) : (
              <Eye className="size-4" strokeWidth={1.75} />
            )}
            <span className="text-xs">{watched ? ui.chat.unwatchThread : ui.chat.watchThread}</span>
          </Button>
          {variant === 'side' ? (
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-accent"
              aria-label={ui.common.close}
              onClick={onClose}
            >
              <X />
            </Button>
          ) : null}
        </span>
      </header>
      <FeedDropzone
        className="relative flex min-h-0 flex-1 flex-col"
        onFiles={(files) => addFiles(scope, files)}
      >
        <MessageScrollerProvider autoScroll>
          <ScrollEndResponder scope={scope} />
          <JumpResponder
            conversationId={conversationId}
            threadRootId={threadRootId}
            itemCount={items.length}
            containerRef={viewportRef}
          />
          <MessageScroller className="min-h-0 flex-1 bg-chat-zone">
            <MessageScrollerViewport ref={viewportRef}>
              <MessageScrollerContent
                className={cn(
                  'feed-reveal px-4 pt-4 pb-0',
                  (selection.selectionActive || box.active) && 'select-none',
                )}
              >
                {/* Р.12: скелетоны-полоски убраны (артефакт первого
                    открытия, см. conversation-pane); пусто → feed-reveal. */}
                {isLoading ? null : (
                  <MessageGroup className="gap-3">
                    {/* Sentinel истории — первый элемент окна трэда (#307). */}
                    {topSentinel}
                    {root ? (
                      <MessageScrollerItem messageId={root.id}>
                        {renderRoot(root)}
                        <span
                          aria-hidden
                          className="mt-3 block border-b border-dashed border-border"
                        />
                      </MessageScrollerItem>
                    ) : null}

                    {runs.map((run, runIndex) => {
                      const prevLast = runIndex === 0 ? root : runs[runIndex - 1]?.last;
                      const { first } = run;
                      return (
                        <Fragment key={first.id}>
                          {startsNewDay(prevLast, first) ? (
                            <MessageScrollerItem>
                              <DayChip label={formatDayLabel(first.createdAt)} />
                            </MessageScrollerItem>
                          ) : null}
                          <MessageRunView
                            run={run}
                            showName={!run.mine}
                            renderItem={(message, attrs) => (
                              <MessageScrollerItem messageId={message.id} style={attrs.style}>
                                <MessageRow
                                  messageId={message.id}
                                  selectionKey={message.clientMessageId}
                                  selectable={selection.selectionActive && !message.deletedAt}
                                  selected={selection.selectedSet.has(message.clientMessageId)}
                                  onToggle={(shift) =>
                                    selection.toggle(message.clientMessageId, shift)
                                  }
                                >
                                  {message.deletedAt ? (
                                    <ChatMessageItem
                                      message={message}
                                      mine={run.mine}
                                      showName={attrs.showName}
                                      avatarSlot="none"
                                      tail={attrs.tail}
                                    />
                                  ) : (
                                    <MessageMenu
                                      message={message}
                                      mine={run.mine}
                                      conversationId={conversationId}
                                      scope={scope}
                                      messagesOfSelection={selection.getSelectedMessages}
                                    >
                                      <ChatMessageItem
                                        message={message}
                                        mine={run.mine}
                                        showName={attrs.showName}
                                        avatarSlot="none"
                                        tail={attrs.tail}
                                        reactionsHidden={selection.selectionActive}
                                      />
                                    </MessageMenu>
                                  )}
                                </MessageRow>
                              </MessageScrollerItem>
                            )}
                          />
                        </Fragment>
                      );
                    })}
                    <ConversationViewsLine
                      conversationId={conversationId}
                      messages={items}
                      className="-mt-[3px]"
                    />
                  </MessageGroup>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </FeedDropzone>
      <ChatComposer
        placeholder={ui.chat.replyPlaceholder}
        focusId={scope}
        conversationId={conversationId}
        typingThreadRootId={threadRootId}
        attachmentsEnabled
        onEditLast={handleEditLast}
        selection={selectionComposerProps(conversationId, selection)}
        onSubmit={handleSubmit}
      />
    </div>
  );
});
