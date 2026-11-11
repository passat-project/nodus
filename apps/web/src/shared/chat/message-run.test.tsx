// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { buildMessageRuns, type MessageRun } from './message-groups.js';
import { MessageRunView, type MessageRunItemAttrs } from './message-run.js';
import { useChatPrefs } from './chat-prefs.js';
import { stubLoadedImage } from '../../test/stub-loaded-image.js';

/**
 * Серия-лента с липким аватаром (#164): grid «колонка аватара + пузыри»,
 * аватар — отдельный sticky-элемент на ВСЕ строки серии; дистрибуция канона
 * (имя — первое, хвостик — последний); mine-серии без аватара с занятой
 * колонкой; разделитель непрочитанных — отдельная строка на всю ширину.
 */

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'b', displayName: 'Иван Петров', avatarUrl: null },
  text: 'текст',
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

afterEach(cleanup);

/** jsdom не загружает картинки (см. `stub-loaded-image`). */

let restoreImage: (() => void) | null = null;
afterEach(() => {
  restoreImage?.();
  restoreImage = null;
});

function renderRun(run: MessageRun, dividerBeforeId: string | null = null) {
  const rows: { id: string; attrs: MessageRunItemAttrs }[] = [];
  const { container } = render(
    <MessageRunView
      run={run}
      showName
      dividerBeforeId={dividerBeforeId}
      divider={<div data-testid="unread-divider" />}
      renderItem={(m, attrs) => {
        rows.push({ id: m.id, attrs });
        return <div data-testid={m.id} />;
      }}
    />,
  );
  return { container, rows };
}

describe('MessageRunView — grid серии с липким аватаром (#164)', () => {
  it('чужая серия: аватар — sticky-элемент колонки 1 на все строки, пузыри — колонки 2', () => {
    const run = buildMessageRuns(
      [message({ id: 'm1', seq: 1 }), message({ id: 'm2', seq: 2 }), message({ id: 'm3', seq: 3 })],
      'a',
    )[0]!;
    const { container, rows } = renderRun(run);

    const avatar = container.querySelector('[data-slot="message-run-avatar"]');
    expect(avatar).not.toBeNull();
    expect(avatar!.className).toContain('sticky');
    expect(avatar!.className).toContain('bottom-2');
    expect(avatar!.className).toContain('self-end');
    // графитовый аватар автора (PersonAvatar — инициалы)
    expect(avatar!.textContent).toBe('ИП');

    // строки — вторая колонка, ряды 1..3
    expect(rows.map((r) => r.attrs.style)).toEqual([
      { gridColumn: 2, gridRow: 1 },
      { gridColumn: 2, gridRow: 2 },
      { gridColumn: 2, gridRow: 3 },
    ]);
  });

  it('фото автора из DTO серии рисуется в аватаре серии (#726)', () => {
    restoreImage = stubLoadedImage();
    const photo = 'https://files.nodus.local/avatar/author.png';
    const run = buildMessageRuns(
      [message({ author: { id: 'b', displayName: 'Иван Петров', avatarUrl: photo } })],
      'a',
    )[0]!;
    const { container } = renderRun(run);
    const img = container.querySelector('[data-slot="message-run-avatar"] img');
    expect(img?.getAttribute('src')).toBe(photo);
    expect(img?.getAttribute('alt')).toBe('');
    // без фото — те же инициалы (механизм один)
    const fallbackRun = buildMessageRuns([message()], 'a')[0]!;
    const plain = renderRun(fallbackRun);
    expect(plain.container.querySelector('[data-slot="message-run-avatar"] img')).toBeNull();
    expect(plain.container.querySelector('[data-slot="message-run-avatar"]')?.textContent).toBe(
      'ИП',
    );
  });

  it('дистрибуция канона: имя — только первому, хвостик — только последнему', () => {
    const run = buildMessageRuns(
      [message({ id: 'm1', seq: 1 }), message({ id: 'm2', seq: 2 }), message({ id: 'm3', seq: 3 })],
      'a',
    )[0]!;
    const { rows } = renderRun(run);
    expect(rows.map((r) => ({ id: r.id, ...r.attrs }))).toEqual([
      { id: 'm1', showName: true, tail: false, style: { gridColumn: 2, gridRow: 1 } },
      { id: 'm2', showName: false, tail: false, style: { gridColumn: 2, gridRow: 2 } },
      { id: 'm3', showName: false, tail: true, style: { gridColumn: 2, gridRow: 3 } },
    ]);
  });

  it('своя серия: аватар тоже есть (баг-урок 30.09: «моя аватарка пропала»)', () => {
    const run = buildMessageRuns(
      [message({ id: 'm1', author: { id: 'a', displayName: 'Я', avatarUrl: null } })],
      'a',
    )[0]!;
    const { container, rows } = renderRun(run);
    const avatar = container.querySelector('[data-slot="message-run-avatar"]');
    expect(avatar).not.toBeNull();
    // дефолт 'one': аватар в первой колонке, пузыри — во второй
    expect(rows.map((r) => r.attrs.style)).toEqual([{ gridColumn: 2, gridRow: 1 }]);
  });

  it('«По обе стороны»: своя серия зеркалится — аватар справа, пузыри слева', () => {
    useChatPrefs.setState({ align: 'both' });
    const run = buildMessageRuns(
      [message({ id: 'm1', author: { id: 'a', displayName: 'Я', avatarUrl: null } })],
      'a',
    )[0]!;
    const { container, rows } = renderRun(run);
    const avatar = container.querySelector('[data-slot="message-run-avatar"]');
    expect(avatar).not.toBeNull();
    expect(rows.map((r) => r.attrs.style)).toEqual([{ gridColumn: 1, gridRow: 1 }]);
    useChatPrefs.setState({ align: 'one' });
  });

  it('разделитель непрочитанных внутри серии: своя строка на всю ширину, ряды сдвигаются', () => {
    const run = buildMessageRuns(
      [message({ id: 'm1', seq: 1 }), message({ id: 'm2', seq: 2 }), message({ id: 'm3', seq: 3 })],
      'a',
    )[0]!;
    const { container, rows } = renderRun(run, 'm2');

    const divider = container.querySelector('[data-testid="unread-divider"]')!;
    const dividerCell = divider.parentElement as HTMLElement;
    expect(dividerCell.style.gridColumn).toBe('1 / -1');
    expect(dividerCell.style.gridRow).toBe('2');

    expect(rows.map((r) => r.attrs.style.gridRow)).toEqual([1, 3, 4]);
  });

  it('dividerBeforeId вне серии точку освобождения аватара не сдвигает', () => {
    const run = buildMessageRuns([message({ id: 'm1' })], 'a')[0]!;
    const { container } = renderRun(run, 'чужой-id');
    expect(container.querySelector('[data-testid="unread-divider"]')).toBeNull();
  });

  it('одиночное сообщение: аватар на одну строку (обычное место, sticky не мешает)', () => {
    const run = buildMessageRuns([message({ id: 'm1' })], 'a')[0]!;
    const { rows } = renderRun(run);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attrs.style).toEqual({ gridColumn: 2, gridRow: 1 });
  });

  it('ритм серии: chat — слипание 2px (gap-y-0.5), feed — постовый 6px (gap-y-1.5, #175)', () => {
    const run = buildMessageRuns([message({ id: 'm1' }), message({ id: 'm2', seq: 2 })], 'a')[0]!;
    expect(run.items).toHaveLength(2);
    const chat = render(<MessageRunView run={run} showName renderItem={() => <div />} />);
    expect(chat.container.querySelector('[data-slot="message-run"]')!.className).toContain(
      'gap-y-0.5',
    );
    cleanup();
    const feed = render(
      <MessageRunView run={run} showName spacing="feed" renderItem={() => <div />} />,
    );
    expect(feed.container.querySelector('[data-slot="message-run"]')!.className).toContain(
      'gap-y-1.5',
    );
  });
});
