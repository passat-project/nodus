// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FavoriteCard, Paginated } from '@nodus/contracts';

import { useChatDrafts } from './chat-drafts.js';
import { useConversationOpenStore } from './conversation-open-store.js';
import { favoriteKeys } from './favorites-api.js';
import { useJumpStore } from './jump-store.js';
import { applyFavoriteCardQuote } from './selection-quote-bubble.js';

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
