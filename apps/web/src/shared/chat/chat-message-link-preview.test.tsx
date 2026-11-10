// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { ChatMessageItem } from './chat-message.js';

// Вынесено из chat-message.test.tsx (I5: >500 строк недопустимо).

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderMessage = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'a', displayName: 'Иван Петров', avatarUrl: null },
  text: 'текст сообщения',
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
  createdAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

afterEach(cleanup);

describe('ChatMessageItem — карточка превью ссылки ПОД текстом (#212 ревизия)', () => {
  const img = (n: number, w: number, h: number) => ({
    id: `img-${n}`,
    fileId: `00000000-0000-4000-8000-00000000000${n}`,
    name: `фото-${n}.png`,
    size: 1000,
    mime: 'image/png',
    kind: 'image' as const,
    url: '/demo/site-1.png',
    thumbnailUrl: '/demo/site-1.png',
    previewKind: 'image' as const,
    pdfUrl: null,
    width: w,
    height: h,
  });
  /** Селектор именно OG-КАРТОЧКИ (aria-label): автолинк в тексте несёт тот же
   *  title=url и ловится селектором по атрибуту title. */
  const ogCard = (root: Element | null) => root?.querySelector('a[aria-label]') ?? null;

  it('порядок DOM: текст сообщения выше карточки превью', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({
          text: 'посмотри https://example.com/spec',
          linkPreview: {
            status: 'ready',
            siteName: 'example.com',
            title: 'Спека',
            description: null,
            imageUrl: null,
          },
        })}
        mine={false}
      />,
    );
    const content = container.querySelector('[data-slot="bubble-content"]')!;
    const text = Array.from(content.querySelectorAll('[data-slot="message-text"]'))[0]!;
    const card = ogCard(content);
    expect(card).not.toBeNull();
    // compareDocumentPosition: text должен идти РАНЬШЕ карточки (preceding)
    expect(!!(text.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('мета НЕ перекрывает карточку: булавка погашена, мета строкой ПОД карточкой (#238)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({
          text: 'посмотри https://example.com/spec',
          linkPreview: {
            status: 'ready',
            siteName: 'example.com',
            title: 'Спека',
            description: null,
            imageUrl: null,
          },
        })}
        mine={false}
      />,
    );
    const content = container.querySelector('[data-slot="bubble-content"]')!;
    // флоат-булавка погашена — перекрытия карточки нет
    expect(content.querySelector('[data-slot="meta-corner"]')).toBeNull();
    // мета — обычной строкой ПОД карточкой (не невидимый призрак)
    const metaRow = [...content.querySelectorAll('[data-slot="message-meta"]')].find(
      (m) => !m.className.includes('invisible'),
    );
    expect(metaRow).toBeTruthy();
    const card = ogCard(content);
    expect(!!(card!.compareDocumentPosition(metaRow!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
  });

  it('медиа-подпись со ссылкой-превью: булавка нижней части тоже погашена (#238)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({
          attachments: [img(1, 1200, 800)],
          text: 'вот https://example.com/spec',
          linkPreview: {
            status: 'ready',
            siteName: 'example.com',
            title: 'Спека',
            description: null,
            imageUrl: null,
          },
        })}
        mine={false}
      />,
    );
    const bottom = container.querySelector(
      '[data-slot="media-message"] [data-slot="bubble-content"]',
    )!;
    expect(ogCard(bottom)).not.toBeNull();
    expect(bottom.querySelector('[data-slot="meta-corner"]')).toBeNull();
  });

  it('failed-превью: карточки нет вовсе — булавка меты на месте (#240 + #238)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({
          text: 'посмотри https://example.com/spec',
          linkPreview: {
            status: 'failed',
            siteName: null,
            title: null,
            description: null,
            imageUrl: null,
          },
        })}
        mine={false}
      />,
    );
    const content = container.querySelector('[data-slot="bubble-content"]')!;
    expect(ogCard(content)).toBeNull();
    expect(content.querySelector('[data-slot="meta-corner"]')).not.toBeNull();
  });
});
