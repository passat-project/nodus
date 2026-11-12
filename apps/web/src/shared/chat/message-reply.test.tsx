// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: null, lastSeq: 0 })),
}));

import { ChatMessageItem } from './chat-message.js';
import { useChatPrefs } from './chat-prefs.js';
import { MessageMenu } from './message-menu.js';

/**
 * #729: вид и доступность язычка «Ответить» — текст на плашке-ступени заливки
 * пузыря, приглушённый, по ховеру темнеет; виден только по ховеру тела пузыря
 * и по фокусу с клавиатуры. Гейты показа — message-reply-gates.test.tsx,
 * геометрия на кромке и мостик — message-reply-bridge.test.tsx.
 */

const SCOPE = 'conversation:conv-1';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const message = (): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'u1', displayName: 'Чужой Автор', avatarUrl: null },
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
  createdAt: '2026-11-13T09:00:00.000Z',
});

function replyButton(): HTMLElement {
  return screen.getByRole('button', { name: ui.chat.replyToMessage });
}

function renderBuffer(mine = false) {
  const msg = message();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MessageMenu message={msg} mine={mine} conversationId="conv-1" scope={SCOPE}>
          <ChatMessageItem message={msg} mine={mine} />
        </MessageMenu>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  useChatPrefs.setState({ align: 'one' });
  vi.restoreAllMocks();
});

describe('Язычок «Ответить» (#729): вид и доступность', () => {
  it('слово «Ответить» на заливке пузыря: без иконки, рамки и тени', () => {
    renderBuffer();
    const button = replyButton();

    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    // Референс Telegram (решения владельца 11–13.11.2026): текст, не иконка.
    expect(button.textContent).toBe(ui.chat.menu.reply);
    expect(button.querySelector('svg')).toBeNull();
    expect(button.classList.contains('rounded-full')).toBe(false);
    expect(button.classList.contains('size-6')).toBe(false);
    // Фон — РОВНО заливка входящего пузыря (ступени-микса нет), текст — цвет
    // текста пузыря. Ни ленты, ни панели, ни хардкода.
    expect(button.classList.contains('bg-bubble-in')).toBe(true);
    expect(button.classList.contains('text-bubble-in-foreground')).toBe(true);
    expect(button.classList.contains('text-muted-foreground')).toBe(false);
    expect(button.className).not.toContain('var(--bubble-out)');
    for (const token of ['bg-chat-zone', 'bg-card', 'bg-muted', 'bg-background', 'bg-primary']) {
      expect(button.classList.contains(token), `чужой фон ${token}`).toBe(false);
    }
    // Никаких магических hex — только токены темы.
    expect(button.className).not.toMatch(/#[0-9a-f]{3,8}/i);
    // Никаких hover-цветов: при наведении плашка не меняет фон/текст
    // (вердикт владельца 13.11.2026) — живёт только cursor: pointer.
    expect(button.className).not.toMatch(/(^|\s)hover:(bg|text|border|ring|opacity|shadow)/);
    expect(button.classList.contains('cursor-pointer')).toBe(true);
    // Клавиатурный фокус виден рингом — это не hover-цвет, его не убираем.
    expect(button.className).toContain('focus-visible:ring-1');
    // Скругление небольшое, без рамки и тени.
    expect(button.classList.contains('rounded-md')).toBe(true);
    expect(button.classList.contains('border')).toBe(false);
    expect(button.className).not.toMatch(/(^|\s)shadow-/);
    // Текст: 12px, по ширине текста, паддинги px-2 — буквы не липнут к краям.
    expect(button.classList.contains('text-xs')).toBe(true);
    expect(button.classList.contains('whitespace-nowrap')).toBe(true);
    expect(button.classList.contains('max-w-full')).toBe(true);
    expect(button.classList.contains('truncate')).toBe(true);
    expect(button.classList.contains('px-2')).toBe(true);
    // Доступное имя — полная фраза из i18n (тултипа нет: слово на экране).
    expect(button.getAttribute('aria-label')).toBe(ui.chat.replyToMessage);
    expect(button.getAttribute('title')).toBeNull();

    button.focus();
    expect(document.activeElement).toBe(button);
    // Канон hover-действий: невидимое по умолчанию обязано открываться фокусом.
    expect(button.className).toContain('focus-visible:opacity-100');
    expect(button.className).toContain('group-hover/bubble:opacity-100');
    // prefers-reduced-motion — без перехода прозрачности.
    expect(button.className).toContain('motion-reduce:transition-none');
  });

  it('своё сообщение: язычка нет вовсе — отвечать на себя нечего', () => {
    useChatPrefs.setState({ align: 'both' });
    renderBuffer(true);

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('язычок живёт ВНУТРИ пузыря (group/bubble) — ховер его открывает', () => {
    renderBuffer();
    const button = replyButton();

    // `group-hover/bubble` сработает только у потомка узла с этим классом:
    // вне пузыря язычок остался бы невидимым навсегда.
    const bubble = button.closest('[data-slot="bubble"]');
    expect(bubble).not.toBeNull();
    expect(bubble!.classList.contains('group/bubble')).toBe(true);
  });

  it('в покое скрыт и не перехватывает клики; открывают его только ховер и фокус', () => {
    renderBuffer();
    const button = replyButton();

    // Покой: невидим и прозрачен для кликов — клик проходит к пузырю.
    expect(button.classList.contains('opacity-0')).toBe(true);
    expect(button.classList.contains('pointer-events-none')).toBe(true);
    // Видимость включают РОВНО два пути: ховер тела пузыря и фокус.
    expect(button.classList.contains('group-hover/bubble:opacity-100')).toBe(true);
    expect(button.classList.contains('focus-visible:opacity-100')).toBe(true);
    expect(button.classList.contains('group-hover/bubble:pointer-events-auto')).toBe(true);
    expect(button.classList.contains('focus-visible:pointer-events-auto')).toBe(true);
    // Никакого «виден всегда»: безусловных opacity-100/pointer-events-auto нет.
    expect(button.classList.contains('opacity-100')).toBe(false);
    expect(button.classList.contains('pointer-events-auto')).toBe(false);
  });

  it('фокус с клавиатуры делает язычок активным элементом (путь без мыши)', () => {
    renderBuffer();
    const button = replyButton();
    button.focus();

    expect(document.activeElement).toBe(button);
  });
});
