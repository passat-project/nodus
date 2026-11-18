// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONV = '8f1c1c1e-5a0f-4f2a-9d2e-3b7a6c1d0e11';
const MESSAGE = '11111111-1111-4111-8111-111111111111';

const messageHit = {
  id: MESSAGE,
  type: 'message' as const,
  title: '',
  snippet: 'трубы \u0001стальные\u0002 для котельной',
  score: 0.8,
  match: 'exact' as const,
  reasons: ['body' as const],
  sourceCreatedAt: '2026-11-18T10:00:00.000Z',
  meta: {
    conversationId: CONV,
    conversationType: 'group' as const,
    conversationLabel: 'Сметчики',
    taskNumber: null,
    regNumber: null,
    messageId: MESSAGE,
    seq: 12,
    threadRootId: null,
    authorId: 'u-1',
    authorName: 'Петров Пётр',
    createdAt: '2026-11-18T10:00:00.000Z',
  },
};

const emptyPage = {
  items: [],
  nextCursor: null,
  total: 0,
  totalCapped: false,
  facets: { types: { message: 0 } },
  hint: null,
  tookMs: 1,
};

const searchState = vi.hoisted(() => ({
  data: undefined as unknown,
  isFetching: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
}));

vi.mock('../api/search.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/search.js')>();
  return { ...actual, useSearchHits: vi.fn(() => searchState) };
});
vi.mock('./chat-queries.js', () => ({
  useConversationMessages: () => ({ data: { items: [] } }),
}));
vi.mock('./favorites-api.js', () => ({
  useFavoriteLabels: () => ({ data: { items: [] } }),
  useFavorites: () => ({ data: undefined }),
  useFavoriteIds: () => new Set([MESSAGE]),
}));

import { useSearchHits } from '../api/search.js';
import { useJumpStore } from './jump-store.js';
import { ChatSearchPanel } from './chat-search-panel.js';

afterEach(cleanup);

function mount(isFavorites = false) {
  return render(
    <ChatSearchPanel
      conversationId={CONV}
      isFavorites={isFavorites}
      active
      overFiles={false}
      onBack={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

function searchWith(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchState.data = undefined;
  searchState.isFetching = false;
  searchState.isError = false;
  searchState.hasNextPage = false;
  searchState.isFetchingNextPage = false;
});

/**
 * Поиск в открытом чате (#956): панель ищет ПО ВСЕМ сообщениям беседы через
 * `/search` + `conversationId`, а не только по «Избранному». «Избранное»
 * (беседа с собой) сохраняет прежний режим записей и закладок.
 */
describe('ChatSearchPanel — поиск сообщений беседы (#956)', () => {
  it('шлёт серверный запрос по беседе и показывает сниппет с подсветкой', async () => {
    searchState.data = { pages: [{ ...emptyPage, items: [messageHit], total: 1 }] };
    mount();

    searchWith('смета');

    // Debounce 250 мс: запрос уходит с введённым запросом, не на каждый символ.
    await waitFor(() => {
      expect(vi.mocked(useSearchHits).mock.calls.at(-1)?.[0]).toMatchObject({
        q: 'смета',
      });
    });
    const request = vi.mocked(useSearchHits).mock.calls.at(-1)?.[0];
    expect(request).toMatchObject({
      q: 'смета',
      types: ['message'],
      conversationId: CONV,
      sort: 'newest',
    });
    expect(screen.getByText('Петров Пётр')).toBeTruthy();
    expect(screen.getByText('стальные').tagName).toBe('MARK');
  });

  it('клик по находке — прыжок к сообщению с подсветкой', async () => {
    searchState.data = { pages: [{ ...emptyPage, items: [messageHit], total: 1 }] };
    mount();
    const request = vi.spyOn(useJumpStore.getState(), 'request');

    searchWith('смета');
    const row = await screen.findByText('Петров Пётр');
    fireEvent.click(row);

    expect(request).toHaveBeenCalledWith(CONV, MESSAGE, null);
  });

  it('один символ — подсказка про минимум, а не пустая выдача', async () => {
    mount();
    searchWith('с');
    expect(screen.getByText('Введите минимум 2 символа')).toBeTruthy();
  });

  it('«Показать ещё» листает выдачу курсором', async () => {
    searchState.data = { pages: [{ ...emptyPage, items: [messageHit], total: 1 }] };
    searchState.hasNextPage = true;
    mount();

    searchWith('смета');
    const more = await screen.findByRole('button', { name: 'Показать ещё' });
    fireEvent.click(more);

    expect(searchState.fetchNextPage).toHaveBeenCalled();
  });

  it('«Избранное» ищет записи и закладки, не сообщения', async () => {
    searchState.data = { pages: [{ ...emptyPage, items: [messageHit], total: 1 }] };
    mount(true);
    // В режиме «Избранного» серверный поиск сообщений выключен.
    expect(vi.mocked(useSearchHits).mock.calls.every(([, opts]) => !opts?.enabled)).toBe(true);
  });
});
