import { memo, useMemo, useRef, Fragment } from 'react';
import { ui } from '@nodus/contracts';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@nodus/ui/components/message-scroller';
import { MessageGroup } from '@nodus/ui/components/message';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../auth-store.js';
import { useConversationMessages } from './chat-queries.js';
import { ChatComposer } from './chat-composer.js';
import { useChatPrefs } from './chat-prefs.js';
import { ConversationViewsLine } from './views-line.js';
import { addFiles } from './composer-files.js';
import { FeedDropzone } from './feed-dropzone.js';
import { FeedScrollerButton } from './feed-scroller-button.js';
import { buildMessageRuns, formatDayLabel, startsNewDay } from './message-groups.js';
import { DayChip } from './day-chip.js';
import { MessageRunView } from './message-run.js';
import { FeedPostRow } from './feed-post-row.js';
import { PinBar } from './pin-bar.js';
import { ScrollEndResponder } from './scroll-end-responder.js';
import { useHistoryLoader } from './use-history-loader.js';
import { useIncomingFollow } from './use-incoming-follow.js';
import { useJumpResponder } from './use-jump-responder.js';
import { useFeedViewportRead } from './use-viewport-read.js';
import { selectionComposerProps, useFeedSelection } from './use-feed-selection.js';
import { useBoxSelection } from './use-box-selection.js';
import { useConversations, useThreadStates } from './chat-queries.js';
import { canPostFeed } from './conversations.js';
import { useFeedSubmit } from './use-feed-submit.js';
import { useConversationHost } from './use-conversation-host.js';

/**
 * Лента канала (вердикт владельца 2026-09-10): каждое сообщение канала —
 * новость-тред. Корневые сообщения — плоские карточки-посты (не пузыри)
 * ОГРАНИЧЕННОЙ ширины (max-w-2xl, референс — каналы Битрикс24). Грамматика
 * поста (рефы владельца 14.09.2026): автор сверху; вложения ВЫШЕ текста;
 * реакции + мета (пин/«изменено»/время — ОБЩИЙ компонент с пузырём чата,
 * `message-meta.tsx`, #96) одной строкой внизу; ответы — отдельной тонированной
 * полосой с аватарами участников и счётчиком и входом «Обсудить».
 * Обвязка линии A (#87): пин-бар ленты (клик по закрепленному ответу треда
 * открывает окно), режим селекта постов, drop-зона файлов, DOM-jump к посту.
 * «Ответить» в меню поста = открыть тред (канон: ответы канала — треды).
 *
 * #175: скролл-стек — ОБЩИЙ с лентой беседы (MessageScroller-примитив +
 * ScrollEndResponder + useIncomingFollow + FeedScrollerButton): стрелка
 * «вниз» с чипом непрочитанных, автодогон чужих постов «у низа», pre-paint
 * компенсация роста (чип реакции не двигает ленту) — единая логика чатов и
 * каналов. Самописный stick-эффект удалён: он мерил «у низа» ПОСЛЕ роста DOM
 * (пост выше 80px — nearBottom уже false, догон не срабатывал). Канал всегда
 * открывается ВНИЗ (вердикт раунда 4) — якорной фазы нет, авто-режим примитива
 * включён с маунта, композер догоняет свои посты тем же scroll-end-store.
 */
export const ThreadFeed = memo(function ThreadFeed({
  conversationId,
  onOpenThread,
  canPost,
}: {
  conversationId: string;
  onOpenThread: (rootId: string) => void;
  /** Доменный гейт публикации поверх матрицы беседы: канал проекта —
   *  объявление, пишут только руководство и `project.channel.post` (Р8 #52);
   *  треды при этом открыты всем участникам. */
  canPost?: boolean;
}) {
  const scope = `feed:${conversationId}`;

  // Открытая беседа для гейта уведомлений (#124/#300): реестр хостов —
  // анмаунт одного хоста не гасит признак, пока жив другой (лента+тред).
  useConversationHost(conversationId);
  const { data, isLoading } = useConversationMessages(conversationId);
  // Право публикации в ленту (I8 на клиенте — только UX; сервер проверяет
  // матрицу сам): без post композер ленты гасится, обсуждение — в тредах.
  const { data: conversationsData } = useConversations();
  const conversation = conversationsData?.items.find((c) => c.id === conversationId) ?? null;
  // Доменный гейт (канал проекта) действует сразу, не дожидаясь списка
  // бесед: иначе композер «объявления» на миг доступен наблюдателю.
  const canPostNow = canPost ?? (conversation !== null ? canPostFeed(conversation) : true);
  // Состояния трэдов текущего пользователя (раунд 3): точка «есть новые» на
  // счётчике ответов поста — только наблюдателям трэда.
  const { data: threadStates } = useThreadStates(conversationId);
  const me = useAuthStore((s) => s.user);
  // «По обе стороны» (#151): свои посты каналов прижимаются вправо, как
  // пузыри чата; посты-карточки уважают ту же настройку, что и сообщения.
  const align = useChatPrefs((s) => s.align);
  const viewportRef = useRef<HTMLDivElement>(null);

  const rawItems = data?.items;
  const items = useMemo(() => rawItems ?? [], [rawItems]);
  const roots = useMemo(
    () => items.filter((m) => m.threadRootId === null && m.replyToId === null),
    [items],
  );
  // Догон чужих постов + pre-paint компенсация роста (#175): общий механизм
  // с лентой беседы; канал открывается вниз без якорной фазы — включён всегда.
  useIncomingFollow({
    scope,
    items: roots,
    meId: me?.id,
    viewportRef,
    enabled: true,
  });
  const repliesByRoot = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const message of items) {
      if (!message.threadRootId) continue;
      const list = map.get(message.threadRootId) ?? [];
      list.push(message);
      map.set(message.threadRootId, list);
    }
    return map;
  }, [items]);

  const selection = useFeedSelection(scope, roots, me?.id);
  // Рамочное выделение (#132 р.6 — модель Telegram webk, та же логика,
  // что сообщения чатов, вердикт «не разделять»); якорь — скролл-контейнер
  // постов.
  const box = useBoxSelection({
    scope,
    viewportRef,
    selectableIds: selection.orderedIds,
    selectionActive: selection.selectionActive,
  });
  useJumpResponder({
    conversationId,
    threadRootId: null,
    itemCount: roots.length,
    containerRef: viewportRef,
  });
  // Догрузка истории постов при прокрутке вверх (#307): sentinel у верха,
  // компенсация скролла общая с лентой беседы.
  const { topSentinel } = useHistoryLoader({
    conversationId,
    viewportRef,
    hasMore: (data?.nextCursor ?? null) !== null,
    items,
    enabled: !isLoading && roots.length > 0,
  });
  // Квитанции просмотров (#102 р.2): IO по строкам постов, root=viewport
  // примитива (механика — use-viewport-read.ts).
  useFeedViewportRead(conversationId, viewportRef, roots);
  // Первый непрочитанный пост — цель стрелки «вниз» (как в чатах, #175):
  // по живому watermark из списка бесед.
  const myLastReadSeq = conversation?.myLastReadSeq ?? null;
  const firstUnreadId = useMemo(() => {
    if (myLastReadSeq === null || (conversation?.unreadCount ?? 0) === 0) return null;
    return roots.find((m) => m.seq > myLastReadSeq && !m.deletedAt)?.id ?? null;
  }, [roots, myLastReadSeq, conversation?.unreadCount]);

  // Протокол хоста ленты: отправка/правка, submit окна вложений, ↑-правка
  // последнего своего поста — use-feed-submit.ts.
  const { handleSubmit, handleEditLast } = useFeedSubmit({
    conversationId,
    scope,
    items: roots,
    meId: me?.id,
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col chat-wallpaper bg-chat-zone">
      {/* Пин-бар НА МЕСТЕ и в селекте: батч-команды — узкий островок
          композера (вердикт 24.09 — верх ленты не двигается). */}
      <PinBar conversationId={conversationId} onOpenThread={onOpenThread} />
      <FeedDropzone
        className="relative flex min-h-0 flex-1 flex-col"
        onFiles={(files) => addFiles(scope, files)}
      >
        <MessageScrollerProvider autoScroll>
          <ScrollEndResponder scope={scope} />
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport ref={viewportRef}>
              {/* Р.12: скелетоны-полоски убраны (три широкие полосы на первое
                  открытие после перезагрузки читались артефактом); лента
                  загрузки — пустая, контент проявляется feed-reveal. */}
              <MessageScrollerContent
                className={cn(
                  'feed-reveal px-4 pt-4 pb-0',
                  (selection.selectionActive || box.active) && 'select-none',
                )}
              >
                {isLoading ? null : roots.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <Empty>
                      <EmptyTitle>{ui.chat.feedEmpty}</EmptyTitle>
                    </Empty>
                  </div>
                ) : (
                  <MessageGroup className="gap-3">
                    {/* Sentinel истории — первый элемент ленты (#307). */}
                    {topSentinel}
                    {/* Р.7: лента ЯКОРИТСЯ НИЗОМ (модель Telegram: переписка
                        растёт снизу вверх — первый пост внизу, пустоты под
                        контентом не бывает): якорение низа — канон
                        MessageScrollerContent (h-max min-h-full justify-end),
                        pill «Просмотрено» всегда у нижней кромки статично. */}
                    {/* Посты — СЕРИЯМИ одного автора/дня (вердикт владельца
                        30.09, #164: как в чатах — один аватар на серию,
                        липкий; имя — у первого ЧУЖОГО поста серии: свои БЕЗ
                        имени, как в чатах (репорт владельца 01.10 #180);
                        ритм серии — «постовый» 6px, #175). Полоса обсуждения
                        — у КАЖДОГО поста со СВОИМИ данными (ответы/счётчик —
                        per-message, а не по первому посту серии: баг-вердикт
                        30.09 — ответ на второй пост серии показывал счётчик
                        первого); дата-чип при смене дня — сепаратор разрыва
                        серии. */}
                    {buildMessageRuns(roots, me?.id).map((run, runIndex, runs) => {
                      const prevRun = runIndex === 0 ? undefined : runs[runIndex - 1];
                      // «По обе стороны» (#151): своя серия прижимается вправо,
                      // аватар зеркалится справа (MessageRunView), карточки — у
                      // правого края; ширина карточки (max-w-2xl) сохраняется.
                      const atEnd = run.mine && align === 'both';
                      return (
                        <Fragment key={run.first.id}>
                          {startsNewDay(prevRun?.last, run.first) ? (
                            <MessageScrollerItem>
                              <DayChip label={formatDayLabel(run.first.createdAt)} />
                            </MessageScrollerItem>
                          ) : null}
                          <MessageRunView
                            run={run}
                            showName={false}
                            spacing="feed"
                            renderItem={(message, attrs) => (
                              <FeedPostRow
                                message={message}
                                mine={run.mine}
                                atEnd={atEnd}
                                showName={message.id === run.first.id && !run.mine}
                                replies={repliesByRoot.get(message.id) ?? []}
                                threadUnread={Boolean(threadStates?.get(message.id)?.unreadCount)}
                                selectionActive={selection.selectionActive}
                                selected={selection.selectedSet.has(message.clientMessageId)}
                                onToggle={(shift) =>
                                  selection.toggle(message.clientMessageId, shift)
                                }
                                conversationId={conversationId}
                                scope={scope}
                                onOpenThread={onOpenThread}
                                getSelectedMessages={selection.getSelectedMessages}
                                style={attrs.style}
                              />
                            )}
                          />
                        </Fragment>
                      );
                    })}
                    {/* Метка просмотров — ВСЕГДА последний элемент ленты постов
                        (модель Битрикс24); текст фильтруется от автора нижнего
                        поста (views-line); зазор сверху = 1.5× нижнего (#132 р.2). */}
                    {/* Пилюля просмотров — ВСЕГДА СЛЕВА (вердикт владельца 29.09:
                        не выравнивается по сторонам даже в «По обе стороны»). */}
                    <ConversationViewsLine
                      conversationId={conversationId}
                      messages={roots}
                      className="-mt-[3px]"
                    />
                  </MessageGroup>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            {/* Стрелка «вниз» (#175): та же, что в чатах, — с непрочитанными
                плавный прыжок к первому непрочитанному посту, без — в конец;
                чип-счётчик непрочитанных живёт на кнопке. */}
            <FeedScrollerButton
              firstUnreadId={firstUnreadId}
              viewportRef={viewportRef}
              unreadCount={conversation?.unreadCount ?? 0}
            />
          </MessageScroller>
        </MessageScrollerProvider>
      </FeedDropzone>
      {/* Композер ленты ВСЕГДА смонтирован (р.8): с правами — полный ввод,
          без прав — строка-заглушка ВНУТРИ островка (disabledPlaceholder) —
          выход из мультиселекта морфится в заглушку той же анимацией, а не
          мгновенной подменой; в селекте — узкий батч-островок (р.6). Гейт
          «нет права post» — только UX (I8: сервер проверяет матрицу сам). */}
      <ChatComposer
        placeholder={ui.chat.newPostPlaceholder}
        focusId={scope}
        conversationId={conversationId}
        attachmentsEnabled
        onEditLast={handleEditLast}
        selection={selectionComposerProps(conversationId, selection)}
        disabledPlaceholder={!canPostNow ? ui.chat.composerNoPostRights : null}
        onSubmit={handleSubmit}
      />
    </div>
  );
});
