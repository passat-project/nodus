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

import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../auth-store.js';
import { useConversationMessages, useConversations } from './chat-queries.js';
import { ChatComposer } from './chat-composer.js';
import { addFiles } from './composer-files.js';
import { FeedDropzone } from './feed-dropzone.js';
import type { ComposerSelection } from './selection-island.js';
import { DayChip } from './day-chip.js';
import { toFavoriteMessage } from './favorite-message.js';
import { ensureOlderPage } from './messages-history.js';
import { useFavorites } from './favorites-api.js';
import {
  useOptimisticFavoriteLabels,
  reconcileOptimisticLabels,
} from './optimistic-favorite-labels.js';
import { JumpResponder } from './use-jump-responder.js';
import { ScrollEndResponder } from './scroll-end-responder.js';
import { useHistoryLoader } from './use-history-loader.js';
import { useIncomingFollow } from './use-incoming-follow.js';
import { FavoriteRunMessage } from './notes-row.js';
import { buildMessageRuns, formatDayLabel, startsNewDay } from './message-groups.js';
import { MessageRunView } from './message-run.js';
import { notesSelectionIds, mergeNotesFlow, splitNotesSelection } from './notes-flow.js';
import { reconcileServerDraft } from './draft-sync.js';
import { useFeedSelection } from './use-feed-selection.js';
import { useBoxSelection } from './use-box-selection.js';
import { useDeleteDialog, useForwardDialog } from './dialog-stores.js';
import { copyMessagesAsText } from './use-selection-keys.js';
import { useSelectionStore } from './selection-store.js';
import { cn } from '@nodus/ui/lib/utils';
import { useFeedSubmit } from './use-feed-submit.js';
import { useConversationHost } from './use-conversation-host.js';

/**
 * Витрина «Избранного» (#171, ревизия 04.10): беседа с собой = плоский
 * единый поток — свои записи + карточки избранного — КЛАССИЧЕСКИМИ пузырями:
 * один конвейер buildMessageRuns → MessageRunView → ChatMessageItem (серии
 * по автору, дата-чипы, медиа-геометрия #187 — ничего нового не выдумано).
 * Карточка — псевдо-сообщение оригинала: имя автора + подпись источника
 * «из …», личные эмодзи-метки вместо публичных реакций (Ф2). Действия над
 * карточкой — ПКМ-меню (FavoriteMenu): «Показать в чате», «Убрать из
 * избранного»; кнопок на пузыре нет. Поиск/фильтры — правая панель беседы
 * в режиме поиска (лупа в шапке, chat-search-panel). Звезда внутри витрины
 * отсутствует (self-reference): пункт меню и звезда селекта скрыты;
 * пересылка ИЗ витрины работает.
 * Открывается вниз (как каналы, #175), без якоря непрочитанных.
 */
export function NotesPane({ conversationId }: { conversationId: string }) {
  const scope = `conversation:${conversationId}`;
  const listQuery = useConversations();
  const conversation = listQuery.data?.items.find((c) => c.id === conversationId) ?? null;
  const meId = useAuthStore((s) => s.user?.id ?? null);

  // Реконсилейшн серверного черновика — синхронно до рендера композера (#132).
  useState(() => {
    reconcileServerDraft(scope, conversation);
    return true;
  });
  useConversationHost(conversationId);

  const messagesQuery = useConversationMessages(conversationId);
  const favoritesQuery = useFavorites();
  const optimisticLabels = useOptimisticFavoriteLabels((s) => s.labels);

  const messages = useMemo(
    () => (messagesQuery.data?.items ?? []).filter((m) => !m.deletedAt),
    [messagesQuery.data],
  );
  const cards = useMemo(
    () => (favoritesQuery.data?.pages ?? []).flatMap((page) => page.items),
    [favoritesQuery.data],
  );
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.messageId, card])), [cards]);
  // Кэш списка догнал оптимистичную метку (карточка с теми же метками) —
  // снять локальную (#215 приёмка: чип не должен мигать между ответом
  // сервера и рефетчем списка).
  useEffect(() => {
    reconcileOptimisticLabels(cards);
  }, [cards]);
  // Дедуп (#171 р.5): сообщение-запись с тэг-строкой рендерится ОДНОЙ
  // строкой (записью с тэгами) — карточку того же messageId в поток не
  // пускаем. Личные тэги — ЕДИНЫЙ слой реакций всей витрины (публичных
  // реакций тут нет): и на записях, и на карточках.
  const feedCards = useMemo(
    () => cards.filter((card) => !messages.some((m) => m.id === card.messageId)),
    [cards, messages],
  );
  const entries = useMemo(() => mergeNotesFlow(messages, feedCards), [messages, feedCards]);
  const items = useMemo(
    () =>
      entries.map((entry) =>
        entry.kind === 'note' ? entry.message : toFavoriteMessage(entry.card),
      ),
    [entries],
  );
  const feedCardIds = useMemo(() => new Set(feedCards.map((card) => card.messageId)), [feedCards]);
  const runs = useMemo(() => buildMessageRuns(items, meId ?? undefined), [items, meId]);

  // Viewport витрины — цель прыжка с подсветкой (панель поиска, клик по
  // строке выдачи; тот же резидент, что у ленты беседы) и якорь рамки.
  const viewportRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Догрузка истории витрины при прокрутке вверх (#307): записи — курсором
  // ленты заметок, карточки — следующей страницей избранного; поток
  // пересобирается mergeNotesFlow, компенсация скролла — общая.
  // Поля деструктурированы: вызов favoritesQuery.fetchNextPage() — метод
  // объекта результата (новый на каждый рендер), deps по полям линтер не
  // признаёт; fetchNextPage TanStack привязан к наблюдателю и стабилен.
  const { hasNextPage: favoritesHasNext, fetchNextPage: fetchFavoritesPage } = favoritesQuery;
  const fetchFavoritesNext = useCallback(() => {
    if (!favoritesHasNext) return Promise.resolve(false);
    return fetchFavoritesPage()
      .then(() => true)
      .catch(() => false);
  }, [favoritesHasNext, fetchFavoritesPage]);
  const { topSentinel } = useHistoryLoader({
    conversationId,
    viewportRef,
    hasMore: (messagesQuery.data?.nextCursor ?? null) !== null || favoritesQuery.hasNextPage,
    items,
    enabled: items.length > 0,
    loadMore: useCallback(async () => {
      const notesOlder = await ensureOlderPage(queryClient, conversationId, null);
      const cardsOlder = await fetchFavoritesNext();
      return notesOlder || cardsOlder;
    }, [conversationId, fetchFavoritesNext, queryClient]),
  });

  // Селект по КОМБИНИРОВАННОМУ потоку (#215): orderedIds покрывает и записи,
  // и карточки (Shift-диапазон и рамка — по порядку витрины); meId нужен
  // канону «все свои» (для витрины корзина всё равно всегда доступна —
  // deletable ниже).
  const selection = useFeedSelection(scope, items, meId ?? undefined);
  // Рамочное выделение (#215, паритет с лентой беседы): старт «на строке»/
  // на пустом месте, в режиме селекта — откуда угодно.
  const box = useBoxSelection({
    scope,
    viewportRef,
    selectableIds: selection.orderedIds,
    selectionActive: selection.selectionActive,
  });

  // Догон/компенсация роста (#215, паритет с лентой беседы): у низа лента
  // стоит неподвижно ДО отрисовки — ряд тэгов под пузырём растит контент
  // ВВЕРХ (стиль «реакции толкают пузыри вверх»), новая карточка чужого
  // автора дотягивает в конец. Свои записи дотягивает композер
  // (ScrollEndResponder); якорной фазы у витрины нет — включено всегда.
  useIncomingFollow({
    scope,
    items,
    meId: meId ?? undefined,
    viewportRef,
    enabled: true,
  });

  // Островок селекта витрины (#215): корзина доступна ВСЕГДА (маршрутизация
  // записи/карточки — в delete-dialog), а пересылка — только записи: id
  // карточек живут в чужих беседах, сервер форварда ищет источники в ОДНОЙ
  // беседе-источнике (валидатор #215, блокер); карточка пересылается ПКМ
  // «Переслать» из своей исходной беседы. Только карточки в выделении —
  // кнопки пересылки нет.
  const selectionBar: ComposerSelection | null = selection.selectionActive
    ? (() => {
        const keys = selection.orderedIds.filter((id) => selection.selectedSet.has(id));
        // Батч-команды витрины (#243, блокер ревью): карточка — серверная
        // закладка (id валиден, НЕ темп), летящий — только запись seq=0.
        const { ids, pending } = notesSelectionIds(selection.getSelectedMessages(), feedCardIds);
        const { noteIds } = splitNotesSelection(ids, new Set(messages.map((m) => m.id)));
        return {
          count: keys.length,
          ids,
          pending,
          allMine: selection.allMine,
          deletable: true,
          favoritesEnabled: false,
          forwardable: noteIds.length > 0,
          onForward: () => useForwardDialog.getState().open(conversationId, noteIds),
          onDelete: () => {
            if (ids.length > 0) useDeleteDialog.getState().ask(conversationId, ids);
          },
          onCopy: () => copyMessagesAsText(selection.getSelectedMessages()),
          onClear: () => useSelectionStore.getState().exit(),
        };
      })()
    : null;
  // Правка в Заметках (#188, находка живой пробы): сообщения витрины — свои,
  // «Редактировать» в меню предлагается — хост обязан маршрутизировать правку
  // (раньше submit уходил отправкой НОВОГО сообщения). Окно правки вложений
  // идёт через реестр с составом (editComposition) — use-feed-submit.ts;
  // ↑-правки в витрине нет.
  const { handleSubmit } = useFeedSubmit({ conversationId, scope });

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      {/* Drop-зона файлов (#797): витрина — такая же лента, как беседы
          (#716), но родилась до общего приёма драга и осталась без него.
          Композер — СНАРУЖИ зоны: оверлей накрывает ленту, а не поле ввода
          (как в conversation-pane). Вложения встают чипами в композер
          «Избранного» — черновик тот же scope витрины. */}
      <FeedDropzone
        className="relative flex min-h-0 flex-1 flex-col"
        onFiles={(files) => addFiles(scope, files)}
      >
        <MessageScrollerProvider autoScroll>
          {/* Своя отправка дотягивает ленту до конца с любой позиции (#215):
            композер витрины пишет scroll-end-запрос по тому же scope —
            резидент, как у ленты беседы (conversation-pane). */}
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
                  'feed-reveal flex flex-col gap-3 px-4 pt-4 pb-3',
                  (selection.selectionActive || box.active) && 'select-none',
                )}
              >
                {messagesQuery.isLoading && favoritesQuery.isLoading ? null : items.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <Empty>
                      <EmptyTitle>{ui.chat.notesEmpty}</EmptyTitle>
                    </Empty>
                  </div>
                ) : (
                  <MessageGroup className="gap-3">
                    {/* Sentinel истории — первый элемент витрины (#307). */}
                    {topSentinel}
                    {runs.map((run, runIndex) => {
                      const prevRun = runIndex === 0 ? undefined : runs[runIndex - 1];
                      return (
                        <Fragment key={run.first.id}>
                          {startsNewDay(prevRun?.last, run.first) ? (
                            <MessageScrollerItem>
                              <DayChip label={formatDayLabel(run.first.createdAt)} />
                            </MessageScrollerItem>
                          ) : null}
                          <MessageRunView
                            run={run}
                            showName={!run.mine}
                            renderItem={(message, attrs) => (
                              <FavoriteRunMessage
                                message={message}
                                card={
                                  (feedCardIds.has(message.id)
                                    ? cardsById.get(message.id)
                                    : null) ?? null
                                }
                                labelTarget={
                                  // Тэг-цель строки: ЛОКАЛЬНАЯ оптимистичная
                                  // метка первична (новейшая локальная истина
                                  // мутации — иначе WS-рефетч с ещё не
                                  // применённым PATCH мигал чипом, #215),
                                  // затем карточка, затем пустышка (апсерт).
                                  optimisticLabels.has(message.id)
                                    ? {
                                        messageId: message.id,
                                        labels: optimisticLabels.get(message.id)!,
                                      }
                                    : (cardsById.get(message.id) ?? {
                                        messageId: message.id,
                                        labels: [],
                                      })
                                }
                                mine={run.mine}
                                showName={attrs.showName}
                                tail={attrs.tail}
                                style={attrs.style}
                                conversationId={conversationId}
                                scope={scope}
                                selectionActive={selection.selectionActive}
                                selectedSet={selection.selectedSet}
                                onToggle={selection.toggle}
                                messagesOfSelection={selection.getSelectedMessages}
                              />
                            )}
                          />
                        </Fragment>
                      );
                    })}
                  </MessageGroup>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </FeedDropzone>

      <ChatComposer
        key={conversationId}
        placeholder={ui.chat.notesComposerPlaceholder}
        focusId={scope}
        conversationId={conversationId}
        attachmentsEnabled
        selection={selectionBar}
        onSubmit={handleSubmit}
        // Заметки — чат с собой (#171): молнии и подтверждений здесь нет.
        urgentEnabled={false}
      />
    </div>
  );
}
