// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Paginated, UserRef } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { chatKeys } from './chat-keys.js';
import { ReactionPicker } from './reaction-picker.js';

/**
 * Ховер-пилюля реакций (#132, вердикт владельца 28.09): пилюля = сама базовая
 * реакция (клик — сразу toggle, без панели); панель открывается НАВЕДЕНИЕМ на
 * пилюлю, стоит выше неё; закрытие по уходу курсора сбрасывает раскрытие сетки
 * (утечка expanded); клик по эмодзи панели — оптимистичный toggle с users.
 * nwsapi (jsdom) не матчит не-BMP-эмодзи в attribute-селекторах — ищем JS-ом.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const ME_REF: UserRef = { id: 'me', displayName: 'Я', avatarUrl: null };

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: M1,
  conversationId: CONV,
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'me', displayName: 'Я', avatarUrl: null },
  text: 'текст',
  replyToId: null,
  reply: null,
  threadRootId: null,
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-09-27T09:00:00Z',
  ...overrides,
});

function emojiButton(label: string): Element | null {
  return (
    Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === label,
    ) ?? null
  );
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<Paginated<ChatMessage>>(chatKeys.messages(CONV), {
    items: [message()],
    nextCursor: null,
  });
  const posted = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posted(init?.body);
        return new Response(
          JSON.stringify(
            message({ reactions: [{ emoji: '👍', count: 1, mine: true, users: [ME_REF] }] }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const utils = render(
    <QueryClientProvider client={client}>
      <ReactionPicker message={message()} atEnd={false} />
    </QueryClientProvider>,
  );
  return { client, posted, ...utils };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({
    user: { id: 'me', displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
});

describe('ReactionPicker (#132: пилюля = базовая реакция, панель сверху)', () => {
  it('клик по пилюле — СРАЗУ базовая реакция, без открытия панели', async () => {
    const { posted, container } = setup();
    const trigger = container.querySelector('[data-slot="reaction-picker-trigger"]');
    expect(trigger).not.toBeNull();
    // Якорь панели — СТАБИЛЬНАЯ обёртка (р.3): рост пилюли — transform
    // внутренней кнопки, rect якоря не меняется. Раунд 5: базовый размер
    // 20px (size-5), hover scale 1.4 → прежние 28px; выступ вправо
    // >половины (12px), вниз <половины (8px).
    expect(trigger?.tagName).toBe('SPAN');
    expect(trigger?.className).toContain('size-5');
    expect(trigger?.className).toContain('-bottom-2');
    expect(trigger?.className).toContain('-right-3');
    // Видимость — по ховеру ПУЗЫРЯ, не строки ленты (р.2).
    expect(trigger?.className).toContain('group-hover/bubble:opacity-100');
    expect(trigger?.className).not.toContain('group-hover/msg:opacity-100');
    const button = (trigger as Element).querySelector('button');
    expect(button?.className).toContain('size-5');
    expect(button?.className).toContain('hover:scale-[1.4]');
    // Пилюля несёт саму базовую реакцию (анимированный глиф), не иконку-заглушку.
    const glyph = Array.from(trigger?.querySelectorAll('img') ?? []).find(
      (img) => img.alt === '👍',
    );
    expect(glyph).not.toBeNull();

    fireEvent.click(button as Element);
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(String(posted.mock.calls[0]?.[0])).toContain('👍');
    // Панель при этом НЕ открывалась (клик ≠ наведение).
    expect(emojiButton('❤️')).toBeNull();
  });

  it('наведение на пилюлю открывает панель; клик по эмодзи — оптимистичный чип', async () => {
    const { client, container } = setup();
    const trigger = container.querySelector('[data-slot="reaction-picker-trigger"]') as Element;
    fireEvent.mouseEnter(trigger);
    const emoji = await vi.waitFor(() => {
      const found = emojiButton('👍');
      expect(found).not.toBeNull();
      return found as Element;
    });
    // Раунд 3: панель ВСЕГДА сверху пилюли (модель Битрикс24, предсказуемо).
    const pop = document.body.querySelector('[data-slot="reaction-pop"]');
    expect(pop?.getAttribute('data-side')).toBe('top');
    // Размер панели — прежний (р.2: возврат после «мелко»): кнопки 40px,
    // глифы 24px; плотность — зазорами gap-0 между кнопками.
    expect(emoji.className).toContain('size-10');
    const glyph = Array.from(emoji.querySelectorAll('img')).find((img) => img.alt === '👍');
    expect(glyph?.className).toContain('size-6');

    fireEvent.click(emoji);
    await waitFor(() => {
      const cached = (
        client.getQueryData<Paginated<ChatMessage>>(
          chatKeys.messages(CONV),
        ) as Paginated<ChatMessage>
      ).items[0];
      expect(cached?.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, users: [ME_REF] }]);
    });
  });

  it('раскрытие сетки — панель на месте, сетка выезжает (grid-rows)', async () => {
    const { container } = setup();
    const trigger = container.querySelector('[data-slot="reaction-picker-trigger"]') as Element;
    fireEvent.mouseEnter(trigger);
    const more = await vi.waitFor(() => {
      const found = document.body.querySelector('button[aria-expanded="false"]');
      expect(found).not.toBeNull();
      return found as Element;
    });
    fireEvent.click(more);
    await vi.waitFor(() => {
      expect(emojiButton('🙏')).not.toBeNull();
    });
    expect(document.body.querySelector('.grid-rows-\\[1fr\\]')).not.toBeNull();
  });

  it('уход курсора закрывает панель И сбрасывает раскрытие (утечка expanded)', async () => {
    vi.useFakeTimers();
    try {
      const { container } = setup();
      const trigger = container.querySelector('[data-slot="reaction-picker-trigger"]') as Element;
      fireEvent.mouseEnter(trigger);
      const more = await vi.waitFor(() => {
        const found = document.body.querySelector('button[aria-expanded="false"]');
        expect(found).not.toBeNull();
        return found as Element;
      });
      fireEvent.click(more);
      await vi.waitFor(() => {
        expect(document.body.querySelector('.grid-rows-\\[1fr\\]')).not.toBeNull();
      });

      // Курсор ушёл с пилюли и панели → grace 180мс → панель закрыта.
      fireEvent.mouseLeave(trigger);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(emojiButton('👍')).toBeNull();

      // Повторное наведение — панель снова СВЁРНУТА (не «залипает» раскрытой):
      // раскрытие — это grid-rows-клип, состояние живёт в expanded/шевроне.
      fireEvent.mouseEnter(trigger);
      await vi.waitFor(() => {
        expect(emojiButton('👍')).not.toBeNull();
      });
      expect(document.body.querySelector('.grid-rows-\\[1fr\\]')).toBeNull();
      expect(document.body.querySelector('button[aria-expanded="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
