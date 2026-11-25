// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, FavoriteCard, Paginated } from '@nodus/contracts';

import { useChatDrafts } from './chat-drafts.js';
import { useConversationOpenStore } from './conversation-open-store.js';
import { favoriteKeys } from './favorites-api.js';
import { useJumpStore } from './jump-store.js';
import { applyFavoriteCardQuote, SelectionQuoteBubble } from './selection-quote-bubble.js';
import { chatKeys } from './chat-keys.js';

/**
 * Путь карточки избранного в баббле цитаты (#306): клик по кавычкам на
 * карточке витрины = ответ с цитатой в ИСХОДНОМ чате карточки — черновик
 * ответа кладётся в scope треда/беседы, прыжок и открытие — через сторы.
 * Кэш ленты-источника не участвует (снапшот строится из карточки).
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const ROOT = '33333333-3333-4333-8333-333333333333';
const MSG = '22222222-2222-4222-8222-222222222222';

const author = { id: 'a-1', displayName: 'Анна Смирнова', avatarUrl: null };

function card(overrides: Partial<FavoriteCard> = {}): FavoriteCard {
  return {
    messageId: MSG,
    conversationId: CONV,
    conversationTitle: 'Проект «Школа»',
    conversationType: 'group',
    threadRootId: null,
    author,
    text: 'текст оригинала',
    attachments: [],
    editedAt: null,
    deletedAt: null,
    obliterated: false,
    urgent: false,
    labels: [],
    createdAt: '2026-10-04T10:00:00Z',
    favoritedAt: '2026-10-04T11:00:00Z',
    ...overrides,
  };
}

/** Кэш favorites как его держит useFavorites (infinite, страницы). */
function seedFavorites(client: QueryClient, cards: FavoriteCard[]): void {
  client.setQueryData(favoriteKeys.list(), {
    pages: [{ items: cards, nextCursor: null } as Paginated<FavoriteCard>],
    pageParams: [null],
  });
}

function resetStores(): void {
  useChatDrafts.setState({ drafts: {} });
  useJumpStore.setState({ target: null });
  useConversationOpenStore.setState({ request: null });
}

describe('applyFavoriteCardQuote — цитата с карточки избранного (#306)', () => {
  beforeEach(resetStores);

  it('ставит ответ в scope беседы, прыгает и открывает исходный чат', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFavorites(client, [card()]);

    applyFavoriteCardQuote(client, MSG, 'выделенный кусок');

    const draft = useChatDrafts.getState().drafts[`conversation:${CONV}`];
    expect(draft?.reply?.messageId).toBe(MSG);
    expect(draft?.reply?.quoteText).toBe('выделенный кусок');
    expect(useJumpStore.getState().target).toMatchObject({
      conversationId: CONV,
      messageId: MSG,
      threadRootId: null,
    });
    expect(useConversationOpenStore.getState().request).toMatchObject({
      conversationId: CONV,
      threadRootId: null,
    });
  });

  it('ответ трэда кладётся в scope окна трэда', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFavorites(client, [card({ threadRootId: ROOT })]);

    applyFavoriteCardQuote(client, MSG, 'фрагмент');

    const draft = useChatDrafts.getState().drafts[`thread:${ROOT}`];
    expect(draft?.reply?.messageId).toBe(MSG);
    expect(draft?.reply?.inThread).toBe(ROOT);
    expect(useConversationOpenStore.getState().request).toMatchObject({
      conversationId: CONV,
      threadRootId: ROOT,
    });
  });

  it('карточки нет в кэше — тихий no-op', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFavorites(client, []);

    applyFavoriteCardQuote(client, MSG, 'фрагмент');

    expect(useChatDrafts.getState().drafts).toEqual({});
    expect(useJumpStore.getState().target).toBeNull();
    expect(useConversationOpenStore.getState().request).toBeNull();
  });

  it('удалённая карточка — no-op (цитировать нечего)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFavorites(client, [card({ deletedAt: '2026-10-05T10:00:00Z' })]);

    applyFavoriteCardQuote(client, MSG, 'фрагмент');

    expect(useChatDrafts.getState().drafts).toEqual({});
    expect(useConversationOpenStore.getState().request).toBeNull();
  });

  it('не-страничный кэш labels не роняет поиск карточки', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(favoriteKeys.labels(), { items: [] });
    seedFavorites(client, [card()]);

    applyFavoriteCardQuote(client, MSG, 'фрагмент');

    expect(useChatDrafts.getState().drafts[`conversation:${CONV}`]?.reply?.messageId).toBe(MSG);
  });
});

/**
 * Баббл-цитата над выделением — ТОЛЬКО по тексту сообщения (#1021):
 * выделение, содержащее текст (даже с заездом на мету/чип), показывает баббл
 * и цитирует срез до текста; выделение ТОЛЬКО по чипу файла/мете баббл не
 * порождает. jsdom без раскладки — getClientRects подменяется прямоугольником.
 */
describe('SelectionQuoteBubble — баббл только на тексте сообщения (#1021)', () => {
  const SCOPE = `conversation:${CONV}`;

  const message = (): ChatMessage => ({
    id: MSG,
    conversationId: CONV,
    seq: 1,
    clientMessageId: MSG,
    author,
    text: 'текст сообщения целиком',
    replyToId: null,
    reply: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: '2026-11-24T10:00:00Z',
  });

  function seedMessage(client: QueryClient): void {
    // Apply ищет оригинал в кэше ЛЕНТЫ БЕСЕДЫ (ключ по conversationId) —
    // тот же ключ, что у ленты чата, не по id сообщения.
    client.setQueryData(chatKeys.messages(CONV), { items: [message()], nextCursor: null });
  }

  function messageContainer(): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute('data-chat-message', MSG);
    host.setAttribute('data-chat-scope', SCOPE);
    host.setAttribute('data-chat-conversation', CONV);
    host.innerHTML =
      '<span data-slot="message-text">текст сообщения целиком</span>' +
      '<span data-slot="message-meta">12:34</span>';
    document.body.append(host);
    return host;
  }

  function selectRangeOf(start: Node, startOffset: number, end: Node, endOffset: number): void {
    const range = document.createRange();
    range.setStart(start, startOffset);
    range.setEnd(end, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function renderBubble(client: QueryClient): void {
    render(
      <QueryClientProvider client={client}>
        <SelectionQuoteBubble />
      </QueryClientProvider>,
    );
  }

  // jsdom Range вовсе не имеет getClientRects — добавляем заглушку и снимаем
  // её после (spyOn требует существующего свойства).
  const proto = Range.prototype as unknown as Record<string, unknown>;
  let originalRects: unknown;

  beforeEach(() => {
    originalRects = proto.getClientRects;
    proto.getClientRects = () =>
      [
        { width: 40, height: 12, top: 10, right: 60, left: 20, bottom: 22 },
      ] as unknown as DOMRectList;
  });

  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
    if (originalRects === undefined) delete proto.getClientRects;
    else proto.getClientRects = originalRects;
  });

  it('выделение с текстом (и заездом на мету): баббл есть, клик кладёт срез до текста', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedMessage(client);
    const host = messageContainer();
    const text = host.querySelector('[data-slot="message-text"]')!;
    const meta = host.querySelector('[data-slot="message-meta"]')!;
    selectRangeOf(text.firstChild!, 6, meta.firstChild!, 2);
    renderBubble(client);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const bubble = document.querySelector('[data-quote-bubble]') as HTMLElement;
    expect(bubble).not.toBeNull();

    act(() => {
      bubble.click();
    });
    expect(document.querySelector('[data-quote-bubble]')).toBeNull();
    // Срез до текста: мета «12:…» в цитату не попала (#1021).
    expect(useChatDrafts.getState().drafts[SCOPE]?.reply?.quoteText).toBe('сообщения целиком');
    expect(useChatDrafts.getState().drafts[SCOPE]?.reply?.messageId).toBe(MSG);
    host.remove();
  });

  it('выделение ТОЛЬКО по мете (текста нет): баббл не показывается', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedMessage(client);
    const host = messageContainer();
    const meta = host.querySelector('[data-slot="message-meta"]')!;
    selectRangeOf(meta.firstChild!, 0, meta.firstChild!, 4);
    renderBubble(client);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(document.querySelector('[data-quote-bubble]')).toBeNull();
    host.remove();
  });

  it('лента канала (reply-mode=thread): цитата не предлагается (#1027)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedMessage(client);
    const host = messageContainer();
    host.setAttribute('data-chat-reply-mode', 'thread');
    const text = host.querySelector('[data-slot="message-text"]')!;
    selectRangeOf(text.firstChild!, 0, text.firstChild!, 5);
    renderBubble(client);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(document.querySelector('[data-quote-bubble]')).toBeNull();
    host.remove();
  });
});
