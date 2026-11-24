import { Quote } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Paginated } from '@nodus/contracts';
import type { ChatMessage, FavoriteCard } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { chatKeys } from './chat-keys.js';
import { useChatDrafts } from './chat-drafts.js';
import { useConversationOpenStore } from './conversation-open-store.js';
import { toFavoriteMessage } from './favorite-message.js';
import { favoriteKeys } from './favorites-api.js';
import { focusComposer } from './composer-focus.js';
import { useJumpStore } from './jump-store.js';
import { selectionFragmentIn } from './selection-fragment.js';

/**
 * Баббл-цитата над выделением (вердикт 24.09: модель Bitrix24 — выделил текст
 * сообщения → круглая кнопка с кавычками у выделения, клик = ответ с ЧАСТИЧНОЙ
 * цитатой выделенного). Живёт ОДИН на приложение (хост в app-shell): слушает
 * document, сообщение находит по data-атрибутам триггера MessageMenu
 * (data-chat-*), оригинал — в кэше TanStack Query ленты (снапшот ответа
 * строится из ChatMessage, как в контекстном меню). Граничные условия:
 * выделение в одном сообщении (anchor и focus в одном контейнере), пусто/
 * свёрнуто — баббл гаснет; скролл и клик мимо — гаснет; selectionchange во
 * время протяжки не рисует баббл раньше mouseup (канон Bitrix: после отжатия).
 *
 * Карточка избранного (#306): триггер FavoriteMenu несёт только
 * data-chat-message + data-favorite-card (scope исходного чата у него нет) —
 * клик = «Показать в чате» + ответ: снапшот строится из САМОЙ карточки
 * (кэш ленты-источника не нужен), прыжок и открытие чата — через сторы.
 */

const MESSAGE_SELECTOR = '[data-chat-message]';

interface BubbleState {
  x: number;
  y: number;
  scope: string;
  conversationId: string;
  messageId: string;
  /** Выделение на карточке избранного — путь карточки (#306). */
  favoriteCard: boolean;
  /** Контейнер сообщения — источник среза цитаты на клике (#1021). */
  container: Element;
}

function containerOf(node: Node | null): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest(MESSAGE_SELECTOR) ?? null;
}

export function SelectionQuoteBubble() {
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    function compute() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setBubble(null);
        return;
      }
      if (selection.toString().trim().length === 0) {
        setBubble(null);
        return;
      }
      const container = containerOf(selection.anchorNode);
      const focusContainer = containerOf(selection.focusNode);
      if (!container || container !== focusContainer) {
        setBubble(null);
        return;
      }
      // Баббл — ТОЛЬКО над выделением, в котором есть ТЕКСТ сообщения (#1021):
      // выделение имени/меты/чипа файла цитату не порождает.
      const fragment = selectionFragmentIn(container);
      if (!fragment) {
        setBubble(null);
        return;
      }
      // Позиция — СПРАВА от конца выделения, по вертикали последней строки
      // (модель Bitrix24, вердикт 24.09: bubble компактный и не нависает).
      const rects = selection.getRangeAt(0).getClientRects();
      const last = rects.length > 0 ? rects[rects.length - 1] : null;
      if (!last || (last.width === 0 && last.height === 0)) {
        setBubble(null);
        return;
      }
      setBubble({
        x: Math.min(Math.max(last.right + 24, 20), window.innerWidth - 20),
        y: last.top + last.height / 2,
        scope: container.getAttribute('data-chat-scope') ?? '',
        conversationId: container.getAttribute('data-chat-conversation') ?? '',
        messageId: container.getAttribute('data-chat-message') ?? '',
        favoriteCard: container.hasAttribute('data-favorite-card'),
        container,
      });
    }

    function hideOnCollapse() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setBubble(null);
    }

    function hideOnPress(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-quote-bubble]')) return;
      setBubble(null);
    }

    function hide() {
      setBubble(null);
    }

    document.addEventListener('mouseup', compute);
    document.addEventListener('keyup', compute);
    document.addEventListener('selectionchange', hideOnCollapse);
    document.addEventListener('mousedown', hideOnPress, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseup', compute);
      document.removeEventListener('keyup', compute);
      document.removeEventListener('selectionchange', hideOnCollapse);
      document.removeEventListener('mousedown', hideOnPress, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  function apply() {
    if (!bubble) return;
    // Фрагмент пересчитывается НА КЛИКЕ из того же контейнера (#1021):
    // срез на текст сообщения, как при показе баббла.
    const fragment = selectionFragmentIn(bubble.container);
    window.getSelection()?.removeAllRanges();
    setBubble(null);
    if (!fragment) return;
    if (bubble.favoriteCard) {
      applyFavoriteCardQuote(queryClient, bubble.messageId, fragment);
      return;
    }
    if (bubble.scope.length === 0) return;
    const cached = queryClient.getQueryData<Paginated<ChatMessage>>(
      chatKeys.messages(bubble.conversationId),
    );
    const message = cached?.items.find((m) => m.id === bubble.messageId);
    if (!message) return;
    useChatDrafts.getState().setReply(bubble.scope, message, fragment);
    window.setTimeout(() => focusComposer(bubble.scope), 0);
  }

  if (!bubble) return null;
  return createPortal(
    <button
      type="button"
      data-quote-bubble
      onClick={apply}
      aria-label={ui.chat.quoteBubble}
      title={ui.chat.quoteBubble}
      className="fixed z-[80] flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card text-info shadow-md transition-colors hover:bg-accent"
      style={{ left: bubble.x, top: bubble.y }}
    >
      <Quote className="size-3.5" strokeWidth={1.75} />
    </button>,
    document.body,
  );
}

/**
 * Цитата с карточки избранного (#306): карточка ищется в кэшах списка
 * (витрина её уже отрисовала — данные гарантированно здесь), снапшот ответа
 * строится из САМОЙ карточки (toFavoriteMessage — кэш ленты-источника не
 * нужен), дальше как «Показать в чате»: прыжок к оригиналу + открытие
 * беседы/окна треда; композер целевого scope подхватит черновик ответа на
 * маунте. Удалённая/затёртая карточка и карточка вне кэшей — тихий no-op.
 */
export function applyFavoriteCardQuote(
  queryClient: QueryClient,
  messageId: string,
  fragment: string,
): void {
  if (fragment.length === 0) return;
  const caches = queryClient.getQueriesData<InfiniteData<Paginated<FavoriteCard>>>({
    queryKey: favoriteKeys.all,
  });
  for (const [, data] of caches) {
    // Префикс favoriteKeys.all накрывает и не-страничный labels-запрос —
    // пропускаем (инцидент #171: .pages нет, падало TypeError'ом).
    if (!data || !Array.isArray(data.pages)) continue;
    const card = data.pages.flatMap((page) => page.items).find((c) => c.messageId === messageId);
    if (!card) continue;
    if (card.deletedAt || card.obliterated) return;
    const scope = card.threadRootId
      ? `thread:${card.threadRootId}`
      : `conversation:${card.conversationId}`;
    // threadRootId витрина зануляет в псевдо-сообщении (плоский поток) —
    // возвращаем: replyDraftFrom пишет из него inThread (прыжок по цитате
    // ответа должен открывать окно треда, а не ленту канала).
    const message = { ...toFavoriteMessage(card), threadRootId: card.threadRootId ?? null };
    useChatDrafts.getState().setReply(scope, message, fragment);
    useJumpStore.getState().request(card.conversationId, card.messageId, card.threadRootId);
    useConversationOpenStore.getState().open(card.conversationId, card.threadRootId ?? null);
    return;
  }
}
