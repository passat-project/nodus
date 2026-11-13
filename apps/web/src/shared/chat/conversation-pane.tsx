import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@nodus/ui/components/message-scroller';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { MessageGroup } from '@nodus/ui/components/message';
import type { ConversationListItem } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../auth-store.js';
import { useConversationMessages, useConversations } from './chat-queries.js';
import { ChatComposer } from './chat-composer.js';
import { ChatMessageItem } from './chat-message.js';
import { addFiles } from './composer-files.js';
import { DayChip } from './day-chip.js';
import { FeedDropzone } from './feed-dropzone.js';
import { FeedScrollerButton } from './feed-scroller-button.js';
import { MessageMenu } from './message-menu.js';
import { MessageRow } from './message-row.js';
import { buildMessageRuns, formatDayLabel, startsNewDay } from './message-groups.js';
import { MessageRunView } from './message-run.js';
import { decideOpenAnchor } from './open-anchor.js';
import { PinBar } from './pin-bar.js';
import { ScrollEndResponder } from './scroll-end-responder.js';
import { useHistoryLoader } from './use-history-loader.js';
import { useFeedViewportRead } from './use-viewport-read.js';
import { useIncomingFollow } from './use-incoming-follow.js';
import { useFrozenUnreadDivider } from './use-frozen-unread-divider.js';
import { ConversationViewsLine } from './views-line.js';
import { UnreadAnchor } from './use-unread-anchor.js';
import { selectionComposerProps, useFeedSelection } from './use-feed-selection.js';
import { useBoxSelection } from './use-box-selection.js';
import { reconcileServerDraft } from './draft-sync.js';
import { JumpResponder } from './use-jump-responder.js';
import { useJumpStore } from './jump-store.js';
import { useFeedSubmit } from './use-feed-submit.js';
import { useConversationHost } from './use-conversation-host.js';
// >300 строк — обоснование (I5): лента беседы — якорь открытия (раунд 4),
// селект/рамка/прочтения/jump-резиденты в одном потоке; серия вынесена
// в message-run.tsx, оставшееся — хост-обвязка, деление размыло бы её.

/**
 * Обычная беседа (групповой/личный чат, чаты задачи и письма): лента на
 * MessageScroller + композер. Серии одного автора (message-groups), дата-чипы,
 * контекстное меню по правому клику (MessageMenu). Обвязка линии A (#87):
 * сверху — полоса селекта (активен) или лента закрепов (пин-бар); drop-зона
 * файлов на ленте; jump-резидент (цитаты/закрепы/«Переслано от»); черновики
 * и вложения композера — в drafts-сторе per scope.
 *
 * Раунд 3: тело КЕИТСЯ по conversationId (свежий MessageScroller на каждую
 * беседу — до этого переключение сохраняло позицию прокрутки прошлой) и
 * открывается НА ПЕРВОМ НЕПРОЧИТАННОМ (UnreadAnchor + разделитель «Непрочитанные
 * сообщения», модель Telegram); авто-догон включается только когда
 * пользователь сам у низа (модальный autoScroll примитива).
 *
 * Раунд 4: решение об якоре — АСИНХРОННО-НАДЁЖНОЕ. Раньше unreadCount читался
 * на маунте из списка бесед, а при холодном deep-link список ещё не загружен
 * (conversation=undefined → якоря нет) — лента открывалась в конец, и
 * авто-догон «прочитывал» весь хвост. Теперь тело ленты гейтится готовностью
 * списка (обычно мгновенно из кэша; холодный вход — первый запрос, максимум
 * 1.5 c таймаута), и решение принимает decideOpenAnchor уже по данным.
 */
export function ConversationPane({
  conversationId,
  showAuthor = true,
  composerPlaceholder = ui.chat.newMessage,
  emptyLabel = ui.chat.directEmpty,
  conversation,
  composerClassName,
}: {
  conversationId: string;
  showAuthor?: boolean;
  composerPlaceholder?: string;
  emptyLabel?: string;
  /** Геометрия композера хоста (карточка задачи: высота покоя = бар действий). */
  composerClassName?: string;
  /** Строка беседы от find-or-create хоста (чат задачи, личка): якорь
   *  непрочитанных и черновик, когда беседы нет в первой странице списка. */
  conversation?: ConversationListItem;
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Пин-бар остаётся НА МЕСТЕ и в селекте: батч-команды живёт в узком
          островке композера (вердикт 24.09 — верх ленты не двигается). */}
      <PinBar conversationId={conversationId} />
      <ConversationBody
        key={conversationId}
        conversationId={conversationId}
        showAuthor={showAuthor}
        composerPlaceholder={composerPlaceholder}
        emptyLabel={emptyLabel}
        fallback={conversation}
        composerClassName={composerClassName}
      />
    </div>
  );
}

/** Предел ожидания списка бесед (страховка зависшего запроса): дольше —
 *  обычное открытие без якоря (деградация раунда 3), лента не висит. */
const LIST_GATE_TIMEOUT_MS = 1500;

/** Лента беседы: гейт готовности списка → тело (кеится по conversationId). */
function ConversationBody({
  conversationId,
  showAuthor,
  composerPlaceholder,
  emptyLabel,
  fallback,
  composerClassName,
}: {
  conversationId: string;
  showAuthor: boolean;
  composerPlaceholder: string;
  emptyLabel: string;
  fallback?: ConversationListItem;
  composerClassName?: string;
}) {
  const listQuery = useConversations();
  const conversation =
    listQuery.data?.items.find((c) => c.id === conversationId) ?? fallback ?? null;

  // Гейт открытия (раунд 4): решение об якоре требует myLastReadSeq — до
  // разрешения списка лента стоит на скелетоне и НЕ открывается в низ.
  // Строка от хоста (fallback) уже несёт myLastReadSeq — гейт не нужен.
  const [gateTimedOut, setGateTimedOut] = useState(false);
  const gatePending =
    !fallback && listQuery.data === undefined && !listQuery.isError && !gateTimedOut;
  useEffect(() => {
    if (!gatePending) return;
    const t = window.setTimeout(() => setGateTimedOut(true), LIST_GATE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [gatePending]);

  if (gatePending) {
    return <FeedSkeleton />;
  }
  return (
    <ConversationFeed
      conversationId={conversationId}
      conversation={conversation}
      showAuthor={showAuthor}
      composerPlaceholder={composerPlaceholder}
      emptyLabel={emptyLabel}
      composerClassName={composerClassName}
    />
  );
}

function FeedSkeleton() {
  // Р.12: гейт списка — ПУСТАЯ зона чата без полос (три серые полосы
  // читались артефактом «ховеров» на холодном входе после перезагрузки).
  return <div className="flex min-h-0 flex-1 bg-chat-zone" aria-hidden />;
}

/** Тело ленты: монтируется ТОЛЬКО по готовому списку бесед — решение об
 *  якоре (decideOpenAnchor) принимается один раз на маунте по данным. */
function ConversationFeed({
  conversationId,
  conversation,
  showAuthor,
  composerPlaceholder,
  emptyLabel,
  composerClassName,
}: {
  conversationId: string;
  conversation: ConversationListItem | null;
  showAuthor: boolean;
  composerPlaceholder: string;
  emptyLabel: string;
  composerClassName?: string;
}) {
  const scope = `conversation:${conversationId}`;

  // Реконсилейшн серверного черновика (#132, «залипший Огонёк»): в
  // инициализаторе состояния — синхронно ДО рендера композера, поле получает
  // текст сразу; локальный слой первичен (логика — draft-sync.ts).
  useState(() => {
    reconcileServerDraft(scope, conversation);
    return true;
  });

  // Открытая беседа для гейта уведомлений (#124/#300): реестр хостов —
  // анмаунт одного хоста не гасит признак, пока жив другой (лента+тред).
  useConversationHost(conversationId);
  const { data, isLoading } = useConversationMessages(conversationId);
  const me = useAuthStore((s) => s.user);

  // Поиск беседы — правая панель (лупа в шапке, модель Битрикс24): лента
  // не фильтруется, выдача и прыжки — в панели (#171 ревизия 04.10, раунд 3).
  const rawItems = data?.items;
  const items = useMemo(() => rawItems ?? [], [rawItems]);
  const runs = useMemo(() => buildMessageRuns(items, me?.id), [items, me?.id]);
  const selection = useFeedSelection(scope, items, me?.id);
  // Viewport ленты — цель прыжка (scroll-jump): «видно/не видно» и скролл
  // ВНУТРИ контейнера без отрыва низа (вердикт 25.09).
  const viewportRef = useRef<HTMLDivElement>(null);
  // Догрузка истории при прокрутке вверх (#307, модель Telegram): sentinel
  // у верха ленты, позиция просмотра сохраняется компенсацией скролла.
  const { topSentinel } = useHistoryLoader({
    conversationId,
    viewportRef,
    hasMore: (data?.nextCursor ?? null) !== null,
    items,
    enabled: !isLoading && items.length > 0,
  });
  // Рамочное выделение (#132 р.6 — модель Telegram webk: старт «на строке»
  // или откуда угодно в режиме селекта; текст → выход за поверхность →
  // весь пузырь; якорь строк — viewport ленты).
  const box = useBoxSelection({
    scope,
    viewportRef,
    selectableIds: selection.orderedIds,
    selectionActive: selection.selectionActive,
  });

  // Якорь открытия (раунд 4): jump-запрос побеждает непрочитанных, иначе
  // unreadCount > 0 → якорь на первом непрочитанном; решение — на маунте.
  const [open] = useState(() =>
    decideOpenAnchor(conversationId, conversation, {
      jumpTarget: useJumpStore.getState().target,
    }),
  );
  // Пока якорь не встал — авто-догон выключен (иначе примитив дёрнул бы
  // ленту в конец на первых данных). Снимается двойным rAF после якоря —
  // после MutationObserver-прохода примитива; дальше модальный autoScroll:
  // догон включается только фактом «пользователь у низа».
  const [anchoring, setAnchoring] = useState(open.anchoring);
  const releaseAnchor = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setAnchoring(false)));
  }, []);
  // Квитанции просмотров (#102 р.2): seq самой новой видимой строки ленты —
  // IO по строкам, root=скроллер (механика — use-viewport-read.ts).
  useFeedViewportRead(conversationId, viewportRef, items);
  // Догон входящих (#132): только после якоря и только «у низа» (Telegram).
  useIncomingFollow({
    scope,
    items,
    meId: me?.id,
    viewportRef,
    enabled: !anchoring,
  });

  // Разделитель непрочитанных (#845, модель Telegram `UnreadBar::freezed`):
  // граница снимается ОДИН раз на открытии и живёт в ленте, пока открыт
  // диалог; прочтение её не двигает и не снимает, новые сообщения открытого
  // чата новую не создают. Раньше плашка считалась по живому watermark:
  // отставший снимок списка «воскрешал» её над уже прочитанным, и вставка/
  // удаление строки дёргали ленту (жалоба владельца). Механика заморозки —
  // use-frozen-unread-divider.ts; открытие без непрочитанных — плашки нет.
  const { dividerId: firstUnreadId, openReadSeq } = useFrozenUnreadDivider({
    items,
    unreadCount: conversation?.unreadCount ?? 0,
    readSeq: conversation?.myLastReadSeq ?? null,
    meId: me?.id,
  });

  // Протокол хоста ленты: отправка/правка, submit окна вложений, ↑-правка
  // последнего своего — use-feed-submit.ts.
  const { handleSubmit, handleEditLast } = useFeedSubmit({
    conversationId,
    scope,
    items,
    meId: me?.id,
  });

  return (
    <>
      <FeedDropzone
        className="relative flex min-h-0 flex-1 flex-col"
        onFiles={(files) => addFiles(scope, files)}
      >
        <MessageScrollerProvider autoScroll={!anchoring}>
          {/* Якорь — по знаку, снятому на маунте (та же точка, что у плашки). */}
          <UnreadAnchor
            items={items}
            isLoading={isLoading}
            anchorSeq={anchoring && open.jump === null ? openReadSeq : null}
            jump={anchoring ? open.jump : null}
            viewportRef={viewportRef}
            onAnchored={releaseAnchor}
          />
          <ScrollEndResponder scope={scope} />
          <JumpResponder
            conversationId={conversationId}
            threadRootId={null}
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
                {/* Р.12: скелетоны-полоски УБРАТЫ (первое открытие после
                    перезагрузки: три серые полосы выглядели артефактом
                    «ховеров», с нижним якорем — у самого низа); лента при
                    загрузке ПУСТА, контент проявляется feed-reveal (160мс),
                    модель Telegram. */}
                {isLoading ? null : items.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <Empty>
                      <EmptyTitle>{emptyLabel}</EmptyTitle>
                    </Empty>
                  </div>
                ) : (
                  <MessageGroup className="gap-3">
                    {/* Sentinel истории — первый элемент ленты (#307): у верха
                        грузит старые страницы, «Начало истории» на исчерпании. */}
                    {topSentinel}
                    {runs.map((run, runIndex) => {
                      const prevRun = runIndex === 0 ? undefined : runs[runIndex - 1];
                      const { first } = run;
                      return (
                        <Fragment key={first.id}>
                          {startsNewDay(prevRun?.last, first) ? (
                            <MessageScrollerItem>
                              <DayChip label={formatDayLabel(first.createdAt)} />
                            </MessageScrollerItem>
                          ) : null}
                          <MessageRunView
                            run={run}
                            showName={showAuthor && !run.mine}
                            dividerBeforeId={firstUnreadId}
                            divider={
                              /* Разделитель непрочитанных — строго НАД первым
                                  непрочитанным сообщением, даже ВНУТРИ серии
                                  (спека раунда 4: якорь по REST-филлу одного
                                  автора оставлял чип над всей серией, за
                                  сгибом); my-[5px] держит ритм 12px (gap-3). */
                              <MessageScrollerItem>
                                <div className="my-[5px]">
                                  <DayChip label={ui.chat.unreadDivider} />
                                </div>
                              </MessageScrollerItem>
                            }
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
                    {/* Метка просмотров — ВСЕГДА последний элемент ленты
                        (модель Битрикс24); текст фильтруется от автора
                        нижнего сообщения (views-line). Зазор сверху 9px =
                        1.5× зазора снизу 6px (pt-1.5 композера) — #132 р.2. */}
                    <ConversationViewsLine
                      conversationId={conversationId}
                      messages={items}
                      className="-mt-[3px]"
                    />
                  </MessageGroup>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            {/* Стрелка «вниз»: с непрочитанными — к первому непрочитанному
                (модель Telegram, раунд 4), без — в конец; чип-счётчик
                непрочитанных — #132. */}
            <FeedScrollerButton
              firstUnreadId={firstUnreadId}
              viewportRef={viewportRef}
              unreadCount={conversation?.unreadCount ?? 0}
            />
          </MessageScroller>
        </MessageScrollerProvider>
      </FeedDropzone>
      {/* key по conversationId: автофокус композера при входе/смене беседы
        (черновик при этом живёт в stores — не теряется, #87). */}
      <ChatComposer
        key={conversationId}
        placeholder={composerPlaceholder}
        focusId={scope}
        conversationId={conversationId}
        attachmentsEnabled
        onEditLast={handleEditLast}
        selection={selectionComposerProps(conversationId, selection)}
        disabledPlaceholder={conversation?.readOnly ? ui.chat.readOnlyChat : null}
        onSubmit={handleSubmit}
        className={composerClassName}
      />
    </>
  );
}
