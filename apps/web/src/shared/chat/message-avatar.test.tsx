// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ChatMessageItem } from './chat-message.js';
import { buildMessageRuns } from './message-groups.js';
import { MessageAuthorAvatar } from './message-avatar.js';
import { MessageRunView } from './message-run.js';
import { registerCardBridge } from '../lib/card-bridge.js';

/**
 * Аватар автора — переход в карточку сотрудника (#728): у чужого сообщения
 * это настоящая кнопка (aria-label из i18n, стек карточек с rect источника),
 * у своего — пассивная аватарка (свой профиль открывается из топбара).
 */

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderMessage = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );

const AUTHOR = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Иван Петров' };

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { ...AUTHOR, avatarUrl: null },
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
  createdAt: '2026-11-12T09:00:00Z',
  ...overrides,
});

afterEach(cleanup);

describe('MessageAuthorAvatar — чужое сообщение открывает карточку сотрудника (#728)', () => {
  it('аватар вне серии — кнопка: подсказка = имя, aria-label = имя + действие', () => {
    const { container } = renderMessage(
      <ChatMessageItem message={message()} mine={false} showName />,
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[data-slot="message-author-avatar"]',
    );
    expect(button).not.toBeNull();
    // Подсказка при наведении — человек, а не название действия (вердикт владельца).
    expect(button!.getAttribute('title')).toBe(AUTHOR.displayName);
    // Скринридер: имя + действие из i18n.
    expect(button!.getAttribute('aria-label')).toBe(
      `${AUTHOR.displayName}, ${ui.chat.openEmployeeCard}`,
    );
    // Нативная кнопка: Enter/Space и тап обрабатывает браузер, фокус — в порядке табуляции.
    expect(button!.getAttribute('type')).toBe('button');
    expect(button!.tabIndex).toBe(0);
    expect(button!.className).toContain('cursor-pointer');
    // Фокус — канон кнопок: тонкая рамка, толстые ринги запрещены.
    expect(button!.className).toContain('focus-visible:ring-1');
    expect(button!.className).toContain('focus-visible:ring-ring/40');
    expect(button!.className).not.toContain('ring-2');
  });

  it('клик — карточка сотрудника через мост, rect источника = сам аватар', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const { container } = renderMessage(
      <ChatMessageItem message={message()} mine={false} showName />,
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[data-slot="message-author-avatar"]',
    )!;
    fireEvent.click(button);
    expect(opener).toHaveBeenCalledTimes(1);
    const [ref, rect] = opener.mock.calls[0]!;
    expect(ref).toEqual({ kind: 'employee', id: AUTHOR.id });
    // Карточка «растёт» из аватара: rect вьюпорта, а не undefined.
    expect(rect).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    close();
  });

  it('клавиатура: кнопка получает фокус и доступна из ленты', () => {
    const { container } = renderMessage(
      <ChatMessageItem message={message()} mine={false} showName />,
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[data-slot="message-author-avatar"]',
    )!;
    button.focus();
    expect(document.activeElement).toBe(button);
    // Tab-порядок не отключён и элемент не aria-hidden (иначе клавиатура не дойдёт).
    expect(button.getAttribute('aria-hidden')).toBeNull();
  });

  it('своё сообщение — аватар без кнопки (карточку себя не открываем)', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const { container } = renderMessage(<ChatMessageItem message={message()} mine showName />);
    expect(container.querySelector('button[data-slot="message-author-avatar"]')).toBeNull();
    // аватар на месте (инициалы) — визуал не изменился
    expect(container.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('ИП');
    fireEvent.click(container.querySelector('[data-slot="avatar"]')!);
    expect(opener).not.toHaveBeenCalled();
    close();
  });
});

describe('Аватар серии (лента мессенджера) — тот же переход (#728)', () => {
  const renderRun = (message: ChatMessage, meId: string) => {
    const run = buildMessageRuns([message], meId)[0]!;
    return render(<MessageRunView run={run} showName={!run.mine} renderItem={() => <div />} />);
  };

  it('чужая серия: аватар — кнопка карточки сотрудника', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const { container } = renderRun(message(), 'me');
    const button = container.querySelector<HTMLButtonElement>(
      '[data-slot="message-run-avatar"] button',
    );
    expect(button).not.toBeNull();
    expect(button!.getAttribute('title')).toBe(AUTHOR.displayName);
    expect(button!.getAttribute('aria-label')).toBe(
      `${AUTHOR.displayName}, ${ui.chat.openEmployeeCard}`,
    );
    fireEvent.click(button!);
    expect(opener.mock.calls[0]![0]).toEqual({ kind: 'employee', id: AUTHOR.id });
    close();
  });

  it('своя серия: аватар есть, но карточку не открывает', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const { container } = renderRun(
      message({ author: { ...AUTHOR, id: 'me', avatarUrl: null } }),
      'me',
    );
    const avatar = container.querySelector('[data-slot="message-run-avatar"]');
    expect(avatar!.textContent).toBe('ИП');
    expect(avatar!.querySelector('button')).toBeNull();
    close();
  });
});

describe('MessageAuthorAvatar — переиспользование в других хостах (#728)', () => {
  it('свой вариант не рисует кнопку, чужой — рисует', () => {
    const own = render(<MessageAuthorAvatar author={{ ...AUTHOR, avatarUrl: null }} mine />);
    expect(own.container.querySelector('button')).toBeNull();
    own.unmount();

    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const theirs = render(
      <MessageAuthorAvatar author={{ ...AUTHOR, avatarUrl: null }} mine={false} />,
    );
    fireEvent.click(theirs.container.querySelector('button')!);
    expect(opener.mock.calls[0]![0]).toEqual({ kind: 'employee', id: AUTHOR.id });
    close();
  });

  it('свой вариант сохраняет классы раскладки хоста (блок перехода: mt-auto прижимает к низу)', () => {
    // Регрессия ревью: голый PersonAvatar терял className — свой блок перехода
    // задачи-письма отклеивался от низа строки.
    const own = render(
      <MessageAuthorAvatar
        author={{ ...AUTHOR, avatarUrl: null }}
        mine
        className="mt-auto shrink-0"
        avatarClassName="size-8"
      />,
    );
    const wrapper = own.container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper.className).toContain('mt-auto');
    expect(wrapper.className).toContain('shrink-0');
    // сам аватар — внутри обёртки, размер не потерян
    expect(wrapper.querySelector('[data-slot="avatar"]')?.className).toContain('size-8');
    expect(own.container.querySelector('button')).toBeNull();
  });
});
