import { vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Общие фикстуры тестов гейтов попапов (desktop-notify.test.ts и
 * desktop-notify-gates.test.ts): мок моста оболочки, payload сообщения и
 * кэш беседы. Вынесено, чтобы файлы тестов не перевалили лимит строк I5.
 */

export const ME = '00000000-0000-4000-8000-000000000001';
export const OTHER = '00000000-0000-4000-8000-000000000002';
export const CONV = '00000000-0000-4000-8000-0000000000c1';

export function installBridge() {
  const bridge = {
    shellVersion: '1.0.0',
    platform: 'windows',
    showPopup: vi.fn(async () => undefined),
    setUnreadBadge: vi.fn(async () => undefined),
    flashTaskbar: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    dismissPopups: vi.fn(async () => undefined),
    setUiTheme: vi.fn(async () => undefined),
    getShellInfo: vi.fn(async () => ({ version: '1.0.0', platform: 'windows' })),
    getUpdateState: vi.fn(async () => ({ status: 'idle', version: null })),
    applyUpdate: vi.fn(async () => undefined),
    shellReady: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => undefined),
  };
  window.nodusDesktop = bridge;
  return bridge;
}

export function messagePayload(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: CONV,
    messageId: '00000000-0000-4000-8000-0000000000ff',
    seq: 1,
    authorId: OTHER,
    threadRootId: null,
    forwarded: false,
    urgent: false,
    mentionedUserIds: [],
    message: {
      id: '00000000-0000-4000-8000-0000000000ff',
      conversationId: CONV,
      seq: 1,
      clientMessageId: 'cli-1',
      author: { id: OTHER, displayName: 'Иван Петрович Смирнов', avatarUrl: null },
      text: 'Доброе утро',
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
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

/** Кэш/догон запроса состояний трэдов беседы («мои наблюдаемые трэды»). */
export function queryClientWith(
  flags: { muted?: boolean; snoozed?: boolean } | null,
  threads: { states?: string[]; fetchStates?: string[] } = {},
): QueryClient {
  const states = (roots: string[]) => ({
    items: roots.map((r) => ({ threadRootId: r, watched: true, unreadCount: 1 })),
  });
  return {
    getQueryData: (key: unknown) => {
      const k = JSON.stringify(key);
      if (k.includes('threadStates')) {
        return threads.states === undefined ? undefined : states(threads.states);
      }
      return flags === null
        ? undefined
        : { items: [{ id: CONV, muted: flags.muted ?? false, snoozed: flags.snoozed ?? false }] };
    },
    fetchQuery: vi.fn(async () => states(threads.fetchStates ?? [])),
  } as unknown as QueryClient;
}

/** Выждать микро/макро-задачи (гейт трэда асинхронный). */
export const flush = () => new Promise((r) => setTimeout(r, 0));
