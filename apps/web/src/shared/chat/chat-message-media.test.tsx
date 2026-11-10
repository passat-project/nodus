// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { ChatMessageItem } from './chat-message.js';
import { uiPx } from '../ui/ui-scale.js';

// Вынесено из chat-message.test.tsx (I5: >500 строк недопустимо).

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderMessage = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={queryClient}>
      {/* Тултип «кто поставил» на чипах реакций требует Provider (#124). */}
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

describe('Медиа-пузырь Telegram (#187): изображение = часть пузыря', () => {
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

  it('чистое изображение без текста — BARE: пузыря нет, чип времени на картинке (#187 п.6)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: '' })}
        mine={false}
      />,
    );
    // пузырь не рендерится вовсе — медиа-блок без Bubble
    expect(container.querySelector('[data-slot="bubble"]')).toBeNull();
    const bare = container.querySelector('[data-slot="media-message"]')!;
    expect(bare).toBeTruthy();
    const frame = bare.querySelector('span.overflow-hidden')!;
    expect(frame).toBeTruthy();
    // чип времени — поверх картинки, тёмная заливка, белый текст
    const chip = frame.querySelector('time')!.closest('span')!;
    expect(chip.className).toContain('bg-black/50');
    expect(chip.className).toContain('text-white');
    expect(chip.className).toContain('absolute');
  });

  it('чужое чистое изображение: полноценная верхняя часть-пузырь над картинкой (р.3 п.4)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: '' })}
        mine={false}
        showName
      />,
    );
    const block = container.querySelector('[data-slot="media-message"]')!;
    // шапка — ЧАСТЬ сообщения (media-part с тоном), не отдельный чип;
    // всегда со скруглённым верхом (раунд 5 п.1)
    const header = block.querySelector('[data-slot="media-part"]')!;
    expect(header).toBeTruthy();
    expect(header.className).toContain('rounded-t-xl');
    expect(header.getAttribute('data-tone')).toBe('in');
    const name = [...header.querySelectorAll('span')].find(
      (el) => el.textContent === 'Иван Петров',
    )!;
    expect(name.className).toMatch(/text-name-[1-7]/);
    // зазор сверху больше зазора до картинки (р.2 п.9), бар растянут
    // увеличенным нижним полем (р.5 п.9)
    expect(header.className).toContain('pt-2.5');
    expect(header.className).toContain('pb-[9px]');
    // шапка — до картинки; картинка top-прямая (без rounded-t), чип времени на ней
    const frame = header.nextElementSibling!;
    expect(frame.querySelector('img')).toBeTruthy();
    expect(frame.className).not.toContain('rounded-t-xl');
    expect(frame.querySelector('time')).toBeTruthy();
    // нет нижней части (текста нет)
    expect(block.querySelectorAll('[data-slot="media-part"]').length).toBe(1);
  });

  it('СВОЁ чистое изображение: частей нет вообще, чип времени на картинке', () => {
    const { container } = renderMessage(
      <ChatMessageItem message={message({ attachments: [img(1, 1200, 800)], text: '' })} mine />,
    );
    const block = container.querySelector('[data-slot="media-message"]')!;
    expect(block.querySelectorAll('[data-slot="media-part"]').length).toBe(0);
    const frame = block.querySelector('span[class*="rounded-t-[12px]"]')!;
    expect(frame.querySelector('time')).toBeTruthy();
    // group/bubble на обёртке — ховер-пилюля реакций работает (р.2 п.3)
    expect(block.className).toContain('group/bubble');
  });

  it('СВОЁ чистое изображение — БЕЗ хвостика и прямого угла (р.5 п.4)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: '' })}
        mine
        tail
      />,
    );
    const block = container.querySelector('[data-slot="media-message"]')!;
    expect(block.querySelector('[data-slot="bubble-fin"]')).toBeNull();
    // соло-картинка скруглена со ВСЕХ сторон (нет выреза под плавник)
    const frame = block.querySelector('span[class*="rounded-t-[12px]"]')!;
    expect(frame.className).not.toContain('rounded-bl-none');
    expect(frame.className).not.toContain('rounded-br-none');
  });

  it('медиа с подписью: хвостовик ЕДИНОЙ фигурой BubbleOutline (р.14)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: 'подпись' })}
        mine
        tail
      />,
    );
    const block = container.querySelector('[data-slot="media-message"]')!;
    // отдельного svg-плавника НЕТ (два растеризатора расходились на зумах)
    expect(block.querySelector('[data-slot="bubble-fin"]')).toBeNull();
    // нижняя часть — Bubble + единый силуэт (коробка+плавник одним путём),
    // тот же механизм, что у текстовых пузырей
    const outline = block.querySelector('[data-slot="bubble-outline"]')!;
    expect(outline).toBeTruthy();
    const bottom = block.querySelector('[data-slot="bubble-content"]')!;
    expect(bottom.className).toContain('rounded-bl-none');
  });

  it('bare: реакции — чипами ПОД картинкой (не пузырь)', () => {
    const withReaction = message({
      attachments: [img(1, 1200, 800)],
      text: '',
      reactions: [{ emoji: '👍', count: 1, mine: true, users: [] }],
    });
    const { container } = renderMessage(<ChatMessageItem message={withReaction} mine={false} />);
    const bare = container.querySelector('[data-slot="media-message"]')!;
    const frame = bare.querySelector('span[class*="rounded-t-[12px]"]')!;
    const chip = bare.querySelector('button[aria-pressed]')!;
    // чип реакции — после картинки в потоке bare-блока (п.9)
    expect(frame.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(frame.contains(chip)).toBe(false);
  });

  it('медиа с подписью: части шапка/картинка/низ, ширина = медиа, фон за картинкой отсутствует', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: 'подпись' })}
        mine={false}
      />,
    );
    const block = container.querySelector('[data-slot="media-message"]') as HTMLElement;
    expect(block.style.width).toBe(`${Math.round(uiPx(480))}px`);
    expect(block.style.maxWidth).toBe('100%');
    // архитепктура «частей» (р.3 п.3): низ = Bubble с rounded-b контентом,
    // картинка над ним — БЕЗ фона за собой
    const bottom = block.querySelector('[data-slot="bubble-content"]')!;
    expect(bottom.className).toContain('rounded-b-xl');
    expect(bottom.className).toContain('w-full');
    // свой верх с подписью (без шапки) — пузыревой радиус (низ-часть рядом)
    const frame = block.querySelector('span[class*="rounded-t-xl"]')!;
    expect(frame).toBeTruthy();
    // за картинкой ничего не рисуется (силуэт — только у нижней части)
    const outlines = block.querySelectorAll('[data-slot="bubble-outline"]');
    expect(outlines.length).toBe(1);
    expect(outlines[0]!.closest('[data-slot="bubble"]')).toBeTruthy();
  });

  it('медиа с подписью и шапкой: шапка → картинка (top прямая) → низ', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: 'подпись' })}
        mine={false}
        showName
      />,
    );
    const block = container.querySelector('[data-slot="media-message"]')!;
    const parts = [...block.querySelectorAll('[data-slot="media-part"]')];
    expect(parts.length).toBe(1); // шапка (низ — Bubble, не media-part)
    const name = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === 'Иван Петров',
    )!;
    expect(parts[0]!.contains(name)).toBe(true);
    // порядок: шапка, картинка (без rounded-t — верх прямой под шапкой), низ-Bubble
    const frame = parts[0]!.nextElementSibling!;
    expect(frame.querySelector('img')).toBeTruthy();
    expect(frame.className).not.toContain('rounded-t-xl');
    const bubble = block.querySelector('[data-slot="bubble"]')!;
    expect(frame.nextElementSibling).toBe(bubble);
  });

  it('подпись: та же пара — призрак в потоке, булавка от края части (р.10)', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: 'подпись к фото' })}
        mine={false}
        showName
      />,
    );
    const block = container.querySelector('[data-slot="media-message"]')!;
    const bottom = block.querySelector('[data-slot="bubble-content"]')!;
    const pin = bottom.querySelector('[data-slot="meta-corner"]')!;
    expect(pin.className).toContain('absolute');
    expect(pin.className).toContain('right-2.5');
    expect(pin.className).toContain('bottom-[8px]');
    // якорь — сама нижняя часть (bubble-content медиа)
    expect(pin.parentElement).toBe(bottom);
    const ghost = [...bottom.querySelectorAll('[data-slot="message-meta"]')].find((m) =>
      m.className.includes('invisible'),
    )!;
    expect(ghost).toBeTruthy();
    expect(bottom.textContent).toContain('подпись к фото');
    // первый отступ строки от картинки увеличен (р.5 п.9)
    expect(bottom.className).toContain('pt-[5px]');
    expect(bottom.className).toContain('pb-[8px]');
  });

  it('плитка одиночного изображения держит пропорции: aspect-ratio вместо фикс-высоты', () => {
    const { container } = renderMessage(
      <ChatMessageItem
        message={message({ attachments: [img(1, 1200, 800)], text: '' })}
        mine={false}
      />,
    );
    const tile = container.querySelector('button[aria-label="фото-1.png"]') as HTMLElement;
    // ширина = ширина пузыря (w-full), высота — из пропорции габаритов
    expect(tile.style.aspectRatio).toBe(`${Math.round(uiPx(480))} / ${Math.round(uiPx(320))}`);
    expect(tile.style.height).toBe('');
    expect(tile.style.width).toBe('');
    expect(tile.className).toContain('w-full');
  });

  it('текстовый пузырь сохраняет единые поля 10px (#181)', () => {
    const { container } = renderMessage(<ChatMessageItem message={message()} mine={false} />);
    const content = container.querySelector('[data-slot="bubble-content"]')!;
    expect(content.className).toContain('px-2.5');
  });
});
