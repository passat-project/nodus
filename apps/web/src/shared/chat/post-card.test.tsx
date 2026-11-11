// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { PostCard } from './post-card.js';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderCard = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );

/**
 * Карточка поста канала (вердикт владельца 30.09, #164 без отдельного
 * issue): аватар — в колонке слева (зона run-grid, в карточке его НЕТ),
 * имя — первая строка карточки; надгробие удалённого поста с живым тредом —
 * двухуровневое: строка «Сообщение удалено» + ТА ЖЕ полоса «Обсудить»
 * (доступ к обсуждениям сохраняется, правило #163 «по ответам»).
 */

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'p1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'a', displayName: 'Иван Петров', avatarUrl: null },
  text: 'текст поста',
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
  createdAt: '2026-09-30T09:00:00Z',
  ...overrides,
});

const base = {
  mine: false,
  atEnd: false,
  showName: true,
  repliesCount: 0,
  participants: [],
  lastReplyAt: null,
  threadUnread: false,
  reactionsHidden: true,
  onOpenThread: vi.fn(),
};

afterEach(cleanup);

describe('PostCard — карточка поста канала с аватаром в колонке (#164)', () => {
  it('живой пост: имя — первая строка карточки; аватара ВНУТРИ карточки нет', () => {
    const { container } = renderCard(<PostCard {...base} message={message()} />);
    const card = container.querySelector('[data-slot="post-surface"]')!;
    expect(card.textContent).toContain('Иван Петров');
    // аватар рисует run-grid отдельным элементом, карточке аватар не нужен
    expect(card.querySelector('img, video')).toBeNull();
    expect(card.className).toContain('rounded-xl'); // мягкая карточка, не пузырь
  });

  it('живой пост: клик по карточке открывает тред', () => {
    const onOpenThread = vi.fn();
    const { container } = renderCard(
      <PostCard {...base} message={message()} onOpenThread={onOpenThread} />,
    );
    const card = container.querySelector('[data-slot="post-surface"]') as HTMLElement;
    card.click();
    expect(onOpenThread).toHaveBeenCalledTimes(1);
  });

  it('надгробие с живым тредом: строка удаления + полоса-кнопка «Обсудить» → тред', () => {
    const onOpenThread = vi.fn();
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({ deletedAt: '2026-09-30T10:00:00Z', text: '', attachments: [] })}
        repliesCount={3}
        onOpenThread={onOpenThread}
      />,
    );
    // двухуровневость: строка удаления (data-slot tombstone) И полоса обсуждения
    expect(container.querySelector('[data-slot="message-tombstone"]')).not.toBeNull();
    const strip = container.querySelector('button')!;
    expect(strip.textContent).toContain('Обсудить');
    strip.click();
    expect(onOpenThread).toHaveBeenCalledTimes(1);
  });

  it('надгробие без ответов: полосы обсуждения нет', () => {
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({ deletedAt: '2026-09-30T10:00:00Z', text: '', attachments: [] })}
      />,
    );
    expect(container.querySelector('[data-slot="message-tombstone"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('живой пост с ответами: счётчик и «Обсудить» в полосе', () => {
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({ threadRepliesCount: 2 })}
        repliesCount={2}
        lastReplyAt="2026-09-30T09:30:00Z"
      />,
    );
    expect(container.querySelector('[data-slot="post-surface"]')!.textContent).toContain(
      '2 ответа',
    );
    expect(container.querySelector('[data-slot="post-surface"]')!.textContent).toContain(
      'Обсудить',
    );
  });

  it('без ответов: счётчика «0 ответов» нет — в полосе только «Обсудить» (вердикт 30.09)', () => {
    const { container } = renderCard(<PostCard {...base} message={message()} />);
    const card = container.querySelector('[data-slot="post-surface"]')!;
    expect(card.textContent).toContain('Обсудить');
    expect(card.textContent).not.toContain('0 ответов');
  });

  it('серия: showName=false — видимого имени нет, sr-only автор остаётся', () => {
    const { container } = renderCard(<PostCard {...base} message={message()} showName={false} />);
    const card = container.querySelector('[data-slot="post-surface"]')!;
    const visible = [...card.querySelectorAll('span')].filter(
      (el) => el.textContent === 'Иван Петров' && !el.className.includes('sr-only'),
    );
    expect(visible).toHaveLength(0);
    expect(card.querySelector('.sr-only')?.textContent).toBe('Иван Петров: ');
  });

  it('надгробие показывает имя ВСЕГДА, даже не-первому в серии (#163: опора цепочки)', () => {
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({ deletedAt: '2026-09-30T10:00:00Z', text: '', attachments: [] })}
        showName={false}
      />,
    );
    const card = container.querySelector('[data-slot="post-surface"]')!;
    expect(card.textContent).toContain('Иван Петров');
  });

  it('клик по заднику лайтбокса закрывает его и НЕ открывает тред (#409)', () => {
    const onOpenThread = vi.fn();
    const img = {
      id: 'f1',
      fileId: '00000000-0000-4000-8000-000000000001',
      name: 'foto.png',
      size: 1000,
      mime: 'image/png',
      kind: 'image' as const,
      url: '/demo/site-1.png',
      thumbnailUrl: '/demo/site-1.png',
      previewKind: 'image' as const,
      pdfUrl: null,
      width: 1200,
      height: 800,
    };
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({ attachments: [img], text: '' })}
        onOpenThread={onOpenThread}
      />,
    );
    const card = container.querySelector('[data-slot="post-surface"]') as HTMLElement;
    // Плитка галереи — единственная кнопка карточки в соло-медиа.
    fireEvent.click(card.querySelector('button')!);
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(dialog).not.toBeNull();

    // Клик мимо картинки: лайтбокс — портал, его React-событие всплывает
    // через дерево компонентов в карточку поста — та не должна открыть тред.
    // Закрытие отложено на паузу двойного клика (#721), поэтому ждём таймер.
    vi.useFakeTimers();
    fireEvent.click(dialog);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();

    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('соло-медиа пост с реакциями: чипы ПОД карточкой, не бар внутри (р.5 п.6)', () => {
    const img = {
      id: 'f1',
      fileId: '00000000-0000-4000-8000-000000000001',
      name: 'foto.png',
      size: 1000,
      mime: 'image/png',
      kind: 'image' as const,
      url: '/demo/site-1.png',
      thumbnailUrl: '/demo/site-1.png',
      previewKind: 'image' as const,
      pdfUrl: null,
      width: 1200,
      height: 800,
    };
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({
          attachments: [img],
          text: '',
          reactions: [{ emoji: '👍', count: 1, mine: true, users: [] }],
        })}
      />,
    );
    const card = container.querySelector('[data-slot="post-surface"]')!;
    // внутри карточки реакций НЕТ: единственная кнопка — плитка-зум
    // картинки, последний блок клипа — полоса обсуждения
    expect(card.querySelector('img')).toBeTruthy();
    expect(card.querySelectorAll('button').length).toBe(1);
    // чипы реакций — сиблинг карточки СНИЗУ, на фоне ленты
    const after = card.nextElementSibling!;
    expect(after.querySelector('button')).toBeTruthy();
    expect(after.textContent).toContain('1');
    // чип времени остаётся НА картинке
    expect(card.querySelector('time')).toBeTruthy();
  });
});

describe('PostCard — OG-карточка и мета (#238, #240)', () => {
  it('готовая OG-карточка: булавка погашена, мета строкой ПОД карточкой', () => {
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({
          text: 'смотрите https://example.com/spec',
          linkPreview: {
            status: 'ready',
            siteName: 'example.com',
            title: 'Спека',
            description: null,
            imageUrl: null,
          },
        })}
      />,
    );
    const card = container.querySelector('[data-slot="post-surface"]')!;
    // флоат-булавка погашена — перекрытия карточки нет
    expect(card.querySelector('[data-slot="meta-corner"]')).toBeNull();
    // мета — обычной строкой ПОД карточкой превью (не невидимый призрак)
    const metaRow = [...card.querySelectorAll('[data-slot="message-meta"]')].find(
      (m) => !m.className.includes('invisible'),
    );
    expect(metaRow).toBeTruthy();
    const og = card.querySelector('a[aria-label]');
    expect(og).not.toBeNull();
    expect(!!(og!.compareDocumentPosition(metaRow!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('failed-превью: карточки нет вовсе — булавка меты на месте (#240)', () => {
    const { container } = renderCard(
      <PostCard
        {...base}
        message={message({
          text: 'смотрите https://example.com/spec',
          linkPreview: {
            status: 'failed',
            siteName: null,
            title: null,
            description: null,
            imageUrl: null,
          },
        })}
      />,
    );
    const card = container.querySelector('[data-slot="post-surface"]')!;
    expect(card.querySelector('a[aria-label]')).toBeNull();
    expect(card.querySelector('[data-slot="meta-corner"]')).not.toBeNull();
  });
});
