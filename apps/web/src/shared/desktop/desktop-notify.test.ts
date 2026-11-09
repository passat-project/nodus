// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../auth-store.js';
import {
  acquireOpenConversation,
  resetOpenConversationRegistry,
} from '../chat/open-conversation.js';
import { setShellVisibleFromShell } from './desktop-bridge.js';
import { notifyDesktopMessage } from './desktop-notify.js';

/**
 * Гейты попапов оболочки (#254/#300, ADR-0019): свои молчат; смотрю в
 * открытую беседу — ПОЛНАЯ тишина, включая «Важное» (вердикт 15.10);
 * «Важное» пробивает muted/snoozed, когда беседы не смотрят; ответ в трэде —
 * только наблюдателям/@упомянутым (канон раунда 3). Опти-ин браузерных
 * уведомлений не участвует.
 */

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const CONV = '00000000-0000-4000-8000-0000000000c1';
const THREAD_ROOT = '00000000-0000-4000-8000-000000000071';
const OTHER_THREAD = '00000000-0000-4000-8000-000000000072';

function installBridge() {
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

function messagePayload(overrides: Record<string, unknown> = {}) {
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
function queryClientWith(
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
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  installBridge();
  resetOpenConversationRegistry();
  setShellVisibleFromShell(true);
  useAuthStore.setState({ user: { id: ME, displayName: 'Я', avatarUrl: null } } as never);
});

describe('notifyDesktopMessage', () => {
  it('чужое сообщение в фоне → попап с именем без отчества и миганием', () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Иван Петрович',
        preview: 'Доброе утро',
        urgent: false,
        canReply: true,
        conversationId: CONV,
      }),
    );
    expect(window.nodusDesktop?.flashTaskbar).toHaveBeenCalledWith(false);
  });

  it('своё сообщение — тишина', () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(
      messagePayload({
        authorId: ME,
        message: {
          ...messagePayload().message,
          author: { id: ME, displayName: 'Я', avatarUrl: null },
        },
      }),
      queryClientWith({}),
    );
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
  });

  it('обычное молчит в заглушённой беседе', () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(messagePayload(), queryClientWith({ muted: true }));
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
  });

  it('обычное молчит в «Посмотреть позже»', () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(messagePayload(), queryClientWith({ snoozed: true }));
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
  });

  it('обычное молчит, когда смотрят В ОТКРЫТУЮ беседу (фокус + видимость)', () => {
    // jsdom: hasFocus() по умолчанию false — мокаем «смотрит» явно.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      acquireOpenConversation(CONV);
      notifyDesktopMessage(messagePayload(), queryClientWith({}));
      expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('смотрю в беседу (лента жива, окно трэда закрыто) — тишина (#300 реестр)', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      const feed = acquireOpenConversation(CONV);
      const thread = acquireOpenConversation(CONV);
      thread(); // закрыли окно трэда — лента держит беседу открытой
      notifyDesktopMessage(messagePayload(), queryClientWith({}));
      expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
      feed();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('фокус на портале, но беседа НЕ открыта (другая страница) — попап', () => {
    // Фидбек владельца 08.10: «мессенджер не открыт» — сообщение не видно,
    // попап нужен; раньше гейт молчал при любом фокусе окна.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      notifyDesktopMessage(messagePayload(), queryClientWith({}));
      expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('открытая беседа без фокуса окна — попап (окно перекрыто другим)', () => {
    acquireOpenConversation(CONV);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      notifyDesktopMessage(messagePayload(), queryClientWith({}));
      expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('обычное звонит, когда окно видимо, но без фокуса (другое приложение)', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      notifyDesktopMessage(messagePayload(), queryClientWith({}));
      expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('важное пробивает mute и snooze, когда беседы не смотрят; мигание критичное', () => {
    setShellVisibleFromShell(false);
    const urgent = messagePayload({
      urgent: true,
      message: { ...messagePayload().message, urgent: true },
    });
    notifyDesktopMessage(urgent, queryClientWith({ muted: true, snoozed: true }));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({ urgent: true }),
    );
    expect(window.nodusDesktop?.flashTaskbar).toHaveBeenCalledWith(true);
  });

  it('#300: важное тоже молчит, когда смотрю в открытую беседу', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      acquireOpenConversation(CONV);
      const urgent = messagePayload({
        urgent: true,
        message: { ...messagePayload().message, urgent: true },
      });
      notifyDesktopMessage(urgent, queryClientWith({ muted: true, snoozed: true }));
      expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('#300: ответ в трэде наблюдателю — попап несёт threadRootId', async () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(
      messagePayload({
        threadRootId: THREAD_ROOT,
        message: { ...messagePayload().message, threadRootId: THREAD_ROOT },
      }),
      queryClientWith({}, { states: [THREAD_ROOT] }),
    );
    await flush();
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({ threadRootId: THREAD_ROOT }),
    );
  });

  it('#300: ответ в трэде не-наблюдателю — тишина (кэш известен)', async () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(
      messagePayload({
        threadRootId: THREAD_ROOT,
        message: { ...messagePayload().message, threadRootId: THREAD_ROOT },
      }),
      queryClientWith({}, { states: [OTHER_THREAD] }),
    );
    await flush();
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
  });

  it('#300: холодный кэш — догоняющий запрос решает (наблюдатель)', async () => {
    setShellVisibleFromShell(false);
    const qc = queryClientWith({}, { fetchStates: [THREAD_ROOT] });
    notifyDesktopMessage(
      messagePayload({
        threadRootId: THREAD_ROOT,
        message: { ...messagePayload().message, threadRootId: THREAD_ROOT },
      }),
      qc,
    );
    await flush();
    expect(qc.fetchQuery).toHaveBeenCalled();
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
  });

  it('#300: @упомянутому в трэде — попап даже без подписки', async () => {
    setShellVisibleFromShell(false);
    notifyDesktopMessage(
      messagePayload({
        threadRootId: THREAD_ROOT,
        mentionedUserIds: [ME],
        message: {
          ...messagePayload().message,
          threadRootId: THREAD_ROOT,
          mentionedUserIds: [ME],
        },
      }),
      queryClientWith({}, { states: [OTHER_THREAD] }),
    );
    await flush();
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
  });

  it('пустой текст заменяется заглушкой вложения', () => {
    setShellVisibleFromShell(false);
    const withAttachment = messagePayload({
      message: {
        ...messagePayload().message,
        text: '',
        attachments: [
          {
            id: '00000000-0000-4000-8000-0000000000a1',
            fileId: '00000000-0000-4000-8000-0000000000f1',
            name: 'photo.png',
            size: 12345,
            mime: 'image/png',
            kind: 'image',
            sticker: null,
            url: null,
            thumbnailUrl: null,
            previewKind: 'image',
            pdfUrl: null,
            width: 800,
            height: 600,
          },
        ],
      },
    });
    notifyDesktopMessage(withAttachment, queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        preview: 'Фотография',
        previewAttachment: true,
      }),
    );
  });
});

describe('в браузере без моста', () => {
  it('гейты даже не вычисляются — вызов тихий', () => {
    delete window.nodusDesktop;
    expect(() => notifyDesktopMessage(messagePayload(), queryClientWith({}))).not.toThrow();
  });
});
