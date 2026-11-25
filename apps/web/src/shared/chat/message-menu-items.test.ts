import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { buildMessageItems } from './message-menu-items.js';

const message = {
  id: 'm1',
  seq: 1,
  threadRootId: null,
  text: 'Текст сообщения',
  readBy: [],
  deletedAt: null,
  attachments: [],
  forwardedFrom: null,
  kind: 'regular',
} as unknown as ChatMessage;

const actions = {
  reply: vi.fn(),
  quoteFragment: vi.fn(),
  copy: vi.fn(),
  edit: vi.fn(),
  forward: vi.fn(),
  toTask: vi.fn(),
  markResult: vi.fn(),
  pin: vi.fn(),
  copyLink: vi.fn(),
  favorite: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
};

const input = (replyMode: 'quote' | 'thread') => ({
  message,
  mine: false,
  fragment: 'фрагмент',
  replyMode,
  isFavorite: false,
  canModerate: false,
  hideFavorite: false,
  taskId: undefined,
  actions,
});

describe('buildMessageItems: цитата в канале (#1027)', () => {
  it('в ленте канала пункта «Цитировать фрагмент» нет', () => {
    const ids = buildMessageItems(input('thread')).items.map((item) => item.id);
    expect(ids).not.toContain('quoteFragment');
  });

  it('в обычном чате/треде пункт цитаты остаётся', () => {
    const ids = buildMessageItems(input('quote')).items.map((item) => item.id);
    expect(ids).toContain('quoteFragment');
  });
});
