import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage } from '@nodus/contracts';
import { stripMentionTokens, ui } from '@nodus/contracts';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cachedConversation } from './chat-queries.js';
import { useMarkMessageAsResult, useMessageToTask } from './conversation-actions.js';
import { useChatDrafts } from './chat-drafts.js';
import { startMessageEdit } from './message-edit.js';
import { focusComposerWhenFree } from './composer-focus.js';
import { useDeleteDialog, useForwardDialog, useUnpinDialog } from './dialog-stores.js';
import { useAddFavorites, useFavoriteIds, useRemoveFavorite } from './favorites-api.js';
import { buildMessageItems, buildSelectionItems, type MenuItem } from './message-menu-items.js';
import { MessageReplyProvider, type MessageReplyAction } from './message-reply.js';
import { usePinToggle } from './pin-mutations.js';
import { useSelectionStore } from './selection-store.js';
import { useCanModerateMessages } from './use-can-moderate.js';
import { copyMessagesAsText } from './use-selection-keys.js';
import { ViewersSubmenu } from './viewers-submenu.js';

/**
 * Реестр действий над сообщением (вердикт владельца 2026-09-11, раунд 3 —
 * модель контекстного меню Битрикс24; линия A #87 сняла заглушки): пункты и
 * порядок зафиксированы, «Копировать ссылку»/«В избранное» остаются stub до
 * соответствующих треков. Новая серверная возможность = обработчик в реестре,
 * меню не меняется. В режиме мультивыбора (A6) меню переключается на действия
 * над выделенными (канон tdesktop: Forward Selected / Delete Selected /
 * Clear Selection).
 *
 * «Цитировать фрагмент» (частичная цитата, Replies 2.0 — вердикт 24.09):
 * пункт появляется, когда контекстное меню открыто с несвёрнутым выделением
 * текста внутри этого сообщения (захват — в capture-фазе contextmenu, до
 * открытия меню; «вечный курсор» селекцию не сбрасывает — канон #71).
 *
 * «Кто просмотрел» (раунд 4, спека владельца): ПОДМЕНЮ в группе
 * недеструктивных команд, сразу над «Удалить» — список посмотревших
 * (аватар + ФИО, max-h-56 со скроллом) из message.readBy. Прежний пункт с
 * попапом «мгновенно пропадал» (война фокуса с «вечным курсором»): подменю —
 * часть слоя меню, фокус не воюет. Попап у счётчика «и ещё N» в pill'е
 * просмотров (views-line) не тронут.
 *
 * I5 (файл > 300 строк): не дробится сознательно — это ХОСТ одного жизненного
 * цикла «сообщение → действия»: сторы/мутации/диалоги, захват фрагмента,
 * исполнение пунктов (`runMenuItem`) и контекст второй точки входа (#729)
 * меняются вместе; вынос частей дал бы циклические импорты и дублирование
 * состояния. Состав и порядок пунктов уже вынесены в билдеры
 * (`message-menu-items.ts`), подменю — в `viewers-submenu.tsx`.
 */
// Состав/порядок пунктов — чистые билдеры message-menu-items.ts, подменю
// «Кто просмотрел» — viewers-submenu.tsx; здесь — хост: сторы, мутации,
// захват фрагмента, исполнение пунктов.

export function MessageMenu({
  message,
  mine,
  conversationId,
  scope,
  replyMode = 'quote',
  onOpenThread,
  messagesOfSelection,
  hideFavorite = false,
  hideReplyButton = false,
  variant,
  children,
}: {
  message: ChatMessage;
  mine: boolean;
  conversationId: string;
  /** draftKey ленты-владельца (`conversation:<id>` / `feed:<id>` / `thread:<rootId>`). */
  scope: string;
  /** Лента канала: «Ответить» открывает тред (канон), не цитату. */
  replyMode?: 'quote' | 'thread';
  onOpenThread?: (rootId: string) => void;
  /** Выделенные сообщения ленты (меню режима селекта: копировать/удалить). */
  messagesOfSelection?: () => ChatMessage[];
  /** Витрина «Избранного» (#171): звезда внутри — self-reference, пункт скрыт. */
  hideFavorite?: boolean;
  /** Хост знает, что это канал, даже если беседы нет в кэше списка (#729):
   *  ховер-кнопка «Ответить» в канале не нужна — её роль играет «Обсудить». */
  hideReplyButton?: boolean;
  /** Окно-источник «Избранного» (#237): набор Telegram — только копировать/
   *  переслать/выбрать/удалить; команды ленты не показываются. */
  variant?: 'source-window';
  children: ReactNode;
}) {
  const toTask = useMessageToTask();
  const markResult = useMarkMessageAsResult();
  const queryClient = useQueryClient();
  const pinToggle = usePinToggle(conversationId);
  const favoriteIds = useFavoriteIds();
  const addFavorites = useAddFavorites();
  const removeFavorite = useRemoveFavorite();
  const canModerate = useCanModerateMessages(conversationId);
  const selectionActive = useSelectionStore((s) => s.scope === scope && s.ids.length > 0);
  const selectedIds = useSelectionStore((s) => (s.scope === scope ? s.ids : EMPTY_IDS));
  const [fragment, setFragment] = useState<string | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  function captureSelection() {
    const selection = window.getSelection();
    const trigger = triggerRef.current;
    if (!selection || selection.isCollapsed || !trigger) {
      setFragment(null);
      return;
    }
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    const inside = anchor && focus && trigger.contains(anchor) && trigger.contains(focus);
    setFragment(inside ? selection.toString().trim() || null : null);
  }

  function setReply(quoteText?: string | null) {
    useChatDrafts.getState().setReply(scope, message, quoteText);
    focusComposerWhenFree(scope);
    if (quoteText) window.getSelection()?.removeAllRanges();
  }

  /** Серверные id подтверждённых записей выделения (#243): селект хранит
   *  ключи clientMessageId (стабильны через замену темпа), командам нужны
   *  настоящие id. Порядок = порядок выделения (цепочка «Избранного», #171).
   *  Пересчёт В МОМЕНТ клика: между открытием меню и кликом очередь
   *  могла подтвердить летящие. */
  function confirmedSelectionIds(): string[] {
    const byKey = new Map((messagesOfSelection?.() ?? []).map((m) => [m.clientMessageId, m]));
    return selectedIds.flatMap((key) => {
      const message = byKey.get(key);
      return message && message.seq > 0 ? [message.id] : [];
    });
  }

  /** В выделении есть летящие (#243): серверные команды меню серые (гри-аут
   *  без уведомлений, вердикт владельца 07.10). */
  const selectionPending =
    selectedIds.length > 0 && confirmedSelectionIds().length !== selectedIds.length;

  const isFavorite = favoriteIds.has(message.id);
  // Беседа владельца меню — один заход в кэш списка: нужен пункту «В задачу»
  // (#252) и правилу #729 «в канале ховер-кнопки «Ответить» нет» (её роль
  // играет постоянная полоса «Обсудить»). Кэш может быть пуст (хост-карточка
  // до загрузки списка) — тогда решает явный флаг хоста `hideReplyButton`.
  const ownerConversation = cachedConversation(queryClient, conversationId);
  const selection = selectionActive
    ? {
        items: buildSelectionItems({
          hideFavorite,
          selectionPending,
          onFavoriteSelected: () => {
            // Порядок цепочки = порядок выделения → поток «Избранного» (#171).
            addFavorites.mutate(confirmedSelectionIds());
            useSelectionStore.getState().exit();
          },
          onForwardSelected: () => {
            const ids = confirmedSelectionIds();
            if (ids.length > 0) useForwardDialog.getState().open(conversationId, ids);
          },
          onDeleteSelected: () => {
            const ids = confirmedSelectionIds();
            if (ids.length > 0) useDeleteDialog.getState().ask(conversationId, ids);
          },
          onCopySelected: () => copyMessagesAsText(messagesOfSelection?.() ?? []),
          onClearSelection: () => useSelectionStore.getState().exit(),
        }),
        showViewers: false,
      }
    : buildMessageItems({
        message,
        mine,
        fragment,
        isFavorite,
        canModerate,
        hideFavorite,
        variant,
        taskId: ownerConversation?.task?.id,
        actions: {
          reply: () => {
            if (replyMode === 'thread') {
              onOpenThread?.(message.threadRootId ?? message.id);
              return;
            }
            setReply(null);
          },
          quoteFragment: () => setReply(fragment),
          copy: () => {
            navigator.clipboard
              // Упоминания — отображаемым текстом без разметки (#176).
              .writeText(stripMentionTokens(message.text))
              .then(() => toast.success(ui.chat.copied))
              .catch(() => toast.error(ui.common.copyError));
            // «Вечный курсор» (баг #91): меню гасило фокус композера — возвращаем
            // после освобождения оверлей-слоёв (канон #71).
            focusComposerWhenFree(scope);
          },
          edit: () => {
            // Правка (#188): сообщение с вложениями — окно правки (состав +
            // текст); без вложений — прежний инлайн-режим композера.
            startMessageEdit(scope, message);
            focusComposerWhenFree(scope);
          },
          forward: () => useForwardDialog.getState().open(conversationId, [message.id]),
          // #432: «В задачу» — быстрый вход единого окна создания; карточка
          // после успеха не открывается (вердикт владельца 26.10).
          toTask: () => toTask(message),
          markResult: (taskId) => markResult.mutate({ taskId, message }),
          pin: () => {
            if (message.pinned) {
              // Открепление — диалог: курсор вернёт dialog-hosts после закрытия.
              useUnpinDialog.getState().ask(conversationId, message.id);
              return;
            }
            pinToggle.pin.mutate(message.id);
            focusComposerWhenFree(scope);
          },
          copyLink: () => {
            toast(ui.chat.actionSoon);
            focusComposerWhenFree(scope);
          },
          favorite: () => {
            // Личная закладка-звезда (#171): toggle без диалогов («звезда мгновенна»).
            if (isFavorite) {
              removeFavorite.mutate(message.id);
            } else {
              addFavorites.mutate([message.id]);
            }
            focusComposerWhenFree(scope);
          },
          select: () => useSelectionStore.getState().enter(scope, message.clientMessageId),
          delete: () => useDeleteDialog.getState().ask(conversationId, [message.id]),
        },
      });

  /** #729: ярлык «Ответить» сбоку от пузыря — ВТОРАЯ точка входа пункта
   *  меню. Отдаём потомкам ДЕЙСТВИЕ пункта реестра: подпись и `run`, который
   *  исполняет пункт через `runMenuItem` — тот же путь, что у клика в меню
   *  (disabled/closeFirst не расходятся с ярлыком при новых флагах). Режим
   *  replyMode и фильтры (селект, окно-источник) живут здесь; нет пункта —
   *  нет ярлыка.
   *
   *  Канал (replyMode='thread') кнопки НЕ получает (вердикт админа
   *  12.11.2026): ответ на пост живёт в тредах, и «Ответить» дублировала бы
   *  постоянную полосу «Обсудить» — та же панель, вторая точка входа не
   *  нужна. Кнопка — только для цитаты в композере (личные/групповые чаты,
   *  чаты задач и писем). Тред канала приходит сюда в режиме 'quote' (ответ
   *  внутри треда — тоже цитата), поэтому канал гасится ещё и по типу
   *  беседы из кэша + флагом хоста `hideReplyButton` (ThreadPane). */
  const replyItem = selection.items.find((item) => item.id === 'reply') ?? null;
  const replyLabel = replyItem?.label ?? null;
  const replyDisabled = replyItem?.disabled ?? true;
  const replyQuotes =
    replyMode !== 'thread' && !hideReplyButton && ownerConversation?.type !== 'project_channel';
  // Свежий пункт для стабильного обработчика: значение контекста не должно
  // менять идентичность на каждом рендере меню (иначе плашка ре-рендерится
  // от любого обновления стора/запроса).
  const replyItemRef = useRef<MenuItem | null>(null);
  useEffect(() => {
    replyItemRef.current = replyItem;
  });
  const replyAction = useMemo<MessageReplyAction | null>(
    () =>
      replyQuotes && replyLabel !== null && !replyDisabled
        ? {
            label: replyLabel,
            run: () => {
              const item = replyItemRef.current;
              if (item) runMenuItem(item);
            },
          }
        : null,
    [replyQuotes, replyLabel, replyDisabled],
  );

  /** #132 р.2: двойной клик по ПУЗРЬКУ = «Ответить» (горячая клавиша
   *  реплая, канон Telegram): по тексту — нативное выделение слова, по
   *  интерактивам и в режиме селекта/каналов — не срабатывает. */
  function replyOnDoubleClick(event: React.MouseEvent) {
    if (replyMode === 'thread' || selectionActive) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest) return;
    if (target.closest('[data-slot="message-text"]')) return;
    if (target.closest('button, a, input, textarea, [contenteditable="true"]')) return;
    setReply(null);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* data-chat-* — координаты для баббла-цитаты выделения
            (selection-quote-bubble): scope/беседа/автор без проп-дрилла. */}
        <span
          ref={triggerRef}
          className="block"
          onContextMenuCapture={(event) => {
            // Меню — ТОЛЬКО по поверхности сообщения (пачка C, вердикт
            // 29.09): пузырь/карточка поста/надгробие/стикер. ПКМ по пустому
            // месту строки ленты не открывает меню: стоп для Radix-триггера
            // (его слушатель — фаза бабблинга этого же span), нативное меню
            // браузера не глушим.
            const target = event.target as HTMLElement | null;
            const onSurface = target?.closest?.(
              // sticker-body/sticker-glyph (#288): плита стикера в ленте
              // переехала на тело «цитата+глиф» (surface остался у постов
              // канала) — ПКМ по стикеру обязан открывать меню как раньше.
              '[data-slot="bubble-content"], [data-slot="post-surface"], [data-slot="message-tombstone"], [data-slot="sticker-surface"], [data-slot="sticker-body"], [data-slot="sticker-glyph"], [data-slot="media-message"]',
            );
            if (!onSurface) {
              event.stopPropagation();
              return;
            }
            captureSelection();
          }}
          onDoubleClick={replyOnDoubleClick}
          data-chat-message={message.id}
          data-chat-scope={scope}
          data-chat-conversation={conversationId}
        >
          <MessageReplyProvider action={replyAction}>{children}</MessageReplyProvider>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {selection.items.map((item) => (
          <span key={item.id}>
            {/* Подменю «Кто просмотрел» — над «Удалить», до сепаратора
                деструктивной группы (раунд 4, спека владельца). */}
            {item.id === 'delete' && selection.showViewers ? (
              <ViewersSubmenu viewers={message.readBy} />
            ) : null}
            {item.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              variant={item.danger ? 'destructive' : 'default'}
              disabled={item.disabled}
              onClick={() => runMenuItem(item)}
            >
              <item.icon className="size-4" strokeWidth={1.75} />
              {item.label}
            </ContextMenuItem>
          </span>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const EMPTY_IDS: string[] = [];

/**
 * #132 р.2: единый исполнитель пункта реестра — для клика в меню и для
 * плашки «Ответить» (#729). disabled гасится молча; closeFirst-пункты
 * (смена режима селекта) ждут закрытия меню (~100мс exit + запас), чтобы
 * контент не морфился в противоположный набор в анимации.
 */
function runMenuItem(item: MenuItem) {
  if (item.disabled) return;
  if (!item.closeFirst) {
    item.run();
    return;
  }
  window.setTimeout(item.run, 170);
}
