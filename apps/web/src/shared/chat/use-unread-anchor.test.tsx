// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { UnreadAnchor } from './use-unread-anchor.js';
import { scrollMessageIntoView } from './scroll-jump.js';

vi.mock('./scroll-jump.js', () => ({ scrollMessageIntoView: vi.fn() }));

/** Регресс #880: якорь открытия фиксируется только по ГОТОВЫМ данным.
 * Устаревший кэш (isLoading=false, isFetching=true) не содержит нового
 * сообщения — прежняя фиксация на нём теряла якорь, и клик по попапу не
 * докручивал ленту к непрочитанному. */
const msg = (id: string, seq: number): ChatMessage =>
  ({
    id,
    conversationId: 'c1',
    seq,
    clientMessageId: `client-${id}`,
    author: { id: 'u1', displayName: 'u1', avatarUrl: null },
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
    createdAt: '2026-11-16T09:00:00Z',
  }) as ChatMessage;

function viewportWith(ids: string[]): { current: HTMLElement } {
  const el = document.createElement('div');
  for (const id of ids) {
    const row = document.createElement('div');
    row.setAttribute('data-message-id', id);
    el.appendChild(row);
  }
  return { current: el };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UnreadAnchor: фиксация по готовым данным (#880)', () => {
  it('не фиксируется на устаревшем кэше, пока идёт рефеч (isFetching)', () => {
    const onAnchored = vi.fn();
    const items = [msg('m1', 1), msg('m2', 2)];
    const viewportRef = viewportWith(['m1', 'm2']);
    const { rerender } = render(
      <UnreadAnchor
        items={items}
        isLoading={false}
        isFetching={true}
        anchorSeq={2}
        jump={null}
        viewportRef={viewportRef}
        onAnchored={onAnchored}
      />,
    );
    // Новое сообщение (seq 3) ещё не приехало — якорь взведён, не снят.
    expect(onAnchored).not.toHaveBeenCalled();
    expect(scrollMessageIntoView).not.toHaveBeenCalled();

    // Рефеч завершился, новое непрочитанное в окне — якорь скроллит к нему.
    const fresh = [...items, msg('m3', 3)];
    rerender(
      <UnreadAnchor
        items={fresh}
        isLoading={false}
        isFetching={false}
        anchorSeq={2}
        jump={null}
        viewportRef={viewportWith(['m1', 'm2', 'm3'])}
        onAnchored={onAnchored}
      />,
    );
    expect(onAnchored).toHaveBeenCalledTimes(1);
    expect(scrollMessageIntoView).toHaveBeenCalledTimes(1);
    const target = vi.mocked(scrollMessageIntoView).mock.calls[0]![0] as HTMLElement;
    expect(target.getAttribute('data-message-id')).toBe('m3');
  });

  it('без непрочитанных снимает блокировку сразу по готовым данным', () => {
    const onAnchored = vi.fn();
    render(
      <UnreadAnchor
        items={[msg('m1', 1)]}
        isLoading={false}
        isFetching={false}
        anchorSeq={null}
        jump={null}
        viewportRef={viewportWith(['m1'])}
        onAnchored={onAnchored}
      />,
    );
    expect(onAnchored).toHaveBeenCalledTimes(1);
    expect(scrollMessageIntoView).not.toHaveBeenCalled();
  });
});
