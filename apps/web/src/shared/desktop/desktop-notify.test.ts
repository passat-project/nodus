// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '../auth-store.js';
import { resetAttentionForTests } from '../attention/attention-store.js';
import { resetModalLayersForTests } from '../attention/modal-layers.js';
import {
  acquireOpenConversation,
  resetOpenConversationRegistry,
} from '../chat/open-conversation.js';
import { setShellVisibleFromShell } from './desktop-bridge.js';
import { notifyDesktopMessage } from './desktop-notify.js';
import {
  CONV,
  flush,
  installBridge,
  ME,
  messagePayload,
  queryClientWith,
} from './desktop-notify.test-helpers.js';
import { resetPopupDecisionsForTests } from './popup-diagnostics.js';

/**
 * Гейты попапов оболочки (#254/#300, ADR-0019): свои молчат; смотрю в
 * открытую беседу — ПОЛНАЯ тишина, включая «Важное» (вердикт 15.10);
 * «Важное» пробивает muted/snoozed, когда беседы не смотрят; ответ в трэде —
 * только наблюдателям/@упомянутым (канон раунда 3). Опти-ин браузерных
 * уведомлений не участвует. Модальный слой и журнал решений — в
 * desktop-notify-gates.test.ts (#809/#811).
 */

const THREAD_ROOT = '00000000-0000-4000-8000-000000000071';
const OTHER_THREAD = '00000000-0000-4000-8000-000000000072';

beforeEach(() => {
  installBridge();
  resetOpenConversationRegistry();
  resetModalLayersForTests();
  resetPopupDecisionsForTests();
  // Модель внимания (#770): окно на виду, свежий ввод — «пользователь смотрит».
  resetAttentionForTests();
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

  it('обычное молчит, когда смотрят В ОТКРЫТУЮ беседу (окно на виду + ввод)', () => {
    acquireOpenConversation(CONV);
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
  });

  it('смотрю в беседу (лента жива, окно трэда закрыто) — тишина (#300 реестр)', () => {
    const feed = acquireOpenConversation(CONV);
    const thread = acquireOpenConversation(CONV);
    thread(); // закрыли окно трэда — лента держит беседу открытой
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
    feed();
  });

  it('фокус на портале, но беседа НЕ открыта (другая страница) — попап', () => {
    // Фидбек владельца 08.10: «мессенджер не открыт» — сообщение не видно,
    // попап нужен; раньше гейт молчал при любом фокусе окна.
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
  });

  it('открытая беседа без фокуса окна — попап (окно перекрыто другим)', () => {
    acquireOpenConversation(CONV);
    resetAttentionForTests({ focused: false });
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
  });

  it('обычное звонит, когда окно видимо, но без фокуса (другое приложение)', () => {
    resetAttentionForTests({ focused: false });
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
  });

  it('бездействие 30+ с (отошёл от ПК) — попап, даже с открытой беседой (#770)', () => {
    acquireOpenConversation(CONV);
    resetAttentionForTests({ lastInputAt: Date.now() - 31_000 });
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
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
    acquireOpenConversation(CONV);
    const urgent = messagePayload({
      urgent: true,
      message: { ...messagePayload().message, urgent: true },
    });
    notifyDesktopMessage(urgent, queryClientWith({ muted: true, snoozed: true }));
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
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
