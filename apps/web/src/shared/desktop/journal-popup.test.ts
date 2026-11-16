// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSnapshot } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { desktopFlashTaskbar, desktopShowPopup } from './desktop-bridge.js';
import { notifyDesktopJournal } from './journal-popup.js';
import { notifyDesktopLetter } from './letter-popup.js';
import { isUserActive } from '../attention/attention-store.js';
import { getOpenConversation } from '../chat/open-conversation.js';

vi.mock('./desktop-bridge.js', () => ({
  isDesktopShell: () => true,
  desktopShowPopup: vi.fn(() => Promise.resolve('sent')),
  desktopFlashTaskbar: vi.fn(),
}));
vi.mock('./letter-popup.js', () => ({ notifyDesktopLetter: vi.fn() }));
vi.mock('../auth-store.js', () => ({
  useAuthStore: { getState: () => ({ user: { id: ME } }) },
}));
vi.mock('../attention/attention-store.js', () => ({ isUserActive: vi.fn(() => false) }));
vi.mock('../attention/modal-layers.js', () => ({ isModalLayerOpen: () => false }));
vi.mock('../chat/open-conversation.js', () => ({ getOpenConversation: vi.fn(() => null) }));

const ME = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const MSG = '44444444-4444-4444-8444-444444444444';

function snap(kind: NotificationSnapshot['kind']): NotificationSnapshot {
  return {
    notificationId: 'n1',
    userId: ME,
    priority: 'high',
    kind,
    sourceId: CONV,
    conversationId: CONV,
    conversationTitle: 'Беседа',
    messageId: MSG,
    threadRootId: null,
    preview: 'новый текст',
    actorName: 'Иван Петров',
  };
}

const qc = new QueryClient();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isUserActive).mockReturnValue(false);
  vi.mocked(getOpenConversation).mockReturnValue(null);
});

describe('notifyDesktopJournal: kinds без живого попапа (#880)', () => {
  it('правка сообщения показывает попап (не urgent) и мигает таскбаром', () => {
    notifyDesktopJournal(snap('chat.message_edited'), 0, qc);
    expect(desktopShowPopup).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(desktopShowPopup).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.id).toBe(MSG);
    expect(payload.conversationId).toBe(CONV);
    expect(payload.urgent).toBe(false);
    expect(payload.title).toBe(ui.notifications.kindTitles['chat.message_edited']);
    expect(desktopFlashTaskbar).toHaveBeenCalledWith(false);
  });

  it('правка в открытой активной беседе — тишина (смотрю в чат)', () => {
    vi.mocked(isUserActive).mockReturnValue(true);
    vi.mocked(getOpenConversation).mockReturnValue(CONV);
    notifyDesktopJournal(snap('chat.message_edited'), 0, qc);
    expect(desktopShowPopup).not.toHaveBeenCalled();
  });

  it('повтор срочного (attempt>0) показывает статичный urgent-попап', () => {
    notifyDesktopJournal(snap('urgent.message'), 2, qc);
    expect(desktopShowPopup).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(desktopShowPopup).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.id).toBe(MSG);
    expect(payload.urgent).toBe(true);
    expect(desktopFlashTaskbar).toHaveBeenCalledWith(true);
  });

  it('первичное срочное (attempt=0) не дублирует живой путь', () => {
    notifyDesktopJournal(snap('urgent.message'), 0, qc);
    expect(desktopShowPopup).not.toHaveBeenCalled();
  });

  it('новое сообщение (chat.direct_message) не дублирует живой путь', () => {
    notifyDesktopJournal(snap('chat.direct_message'), 0, qc);
    expect(desktopShowPopup).not.toHaveBeenCalled();
  });

  it('письмо делегируется notifyDesktopLetter', () => {
    const event = snap('letter.arrived');
    notifyDesktopJournal(event, 0, qc);
    expect(notifyDesktopLetter).toHaveBeenCalledWith(event);
  });

  it('чужое уведомление (userId не я) не показывается', () => {
    notifyDesktopJournal(
      { ...snap('chat.message_edited'), userId: '99999999-9999-4999-8999-999999999999' },
      0,
      qc,
    );
    expect(desktopShowPopup).not.toHaveBeenCalled();
  });
});
