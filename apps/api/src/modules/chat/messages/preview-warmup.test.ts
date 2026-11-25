import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@nodus/contracts';

import type { ThumbnailQueue } from './thumbnail.queue.js';
import { warmMissingPreviews } from './preview-warmup.js';

const msg = (attId: string, thumbnailUrl: string | null): ChatMessage =>
  ({
    id: `m-${attId}`,
    conversationId: 'conv-1',
    seq: 1,
    clientMessageId: `m-${attId}`,
    author: { id: 'u1', displayName: 'А', avatarUrl: null },
    text: '',
    kind: 'text',
    block: null,
    replyToId: null,
    reply: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [
      {
        id: attId,
        fileId: `f-${attId}`,
        name: `${attId}.png`,
        size: 10,
        mime: 'image/png',
        kind: 'image',
        url: `/orig/${attId}`,
        thumbnailUrl,
        previewKind: 'image',
        pdfUrl: null,
        width: 100,
        height: 50,
        durationMs: null,
      },
    ],
    editedAt: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: '2026-10-06T10:00:00Z',
  }) as ChatMessage;

describe('warmMissingPreviews — память прогретых против чурна (ревью #221)', () => {
  it('вечный miss ставит джобу ОДИН раз за процесс (повторные показы — без enqueue)', () => {
    const queue = { enqueue: vi.fn(async () => undefined) } as unknown as ThumbnailQueue;
    warmMissingPreviews([msg('a1', null)], queue);
    warmMissingPreviews([msg('a1', null)], queue);
    warmMissingPreviews([msg('a1', null)], queue);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('готовые превью и не-изображения не трогаются', () => {
    const queue = { enqueue: vi.fn(async () => undefined) } as unknown as ThumbnailQueue;
    warmMissingPreviews([msg('ok', '/thumb')], queue);
    const fileMsg = msg('f1', null);
    fileMsg.attachments[0]!.kind = 'file';
    warmMissingPreviews([fileMsg], queue);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('разные miss-ы — по джобе каждому (id уникальны между тестами: Set живёт в модуле)', () => {
    const queue = { enqueue: vi.fn(async () => undefined) } as unknown as ThumbnailQueue;
    warmMissingPreviews([msg('b1', null), msg('b2', null)], queue);
    warmMissingPreviews([msg('b1', null), msg('b2', null)], queue);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });
});
