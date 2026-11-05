// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationSnapshot } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { notifyDesktopLetter } from './letter-popup.js';

/**
 * Попап «Поступило письмо» (#618): только в оболочке, только свои будила,
 * только kind letter.arrived; письмо — целью попапа (letterId), без ответа.
 */

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const LETTER_ID = '00000000-0000-4000-8000-0000000000e1';

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

function snapshot(overrides: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
  return {
    notificationId: '00000000-0000-4000-8000-000000000041',
    userId: ME,
    priority: 'medium',
    kind: 'letter.arrived',
    sourceId: LETTER_ID,
    sourceType: 'letter',
    conversationId: null,
    conversationTitle: null,
    messageId: null,
    threadRootId: null,
    preview: 'Договор подряда №15',
    actorName: null,
    ...overrides,
  };
}

describe('notifyDesktopLetter (#618)', () => {
  beforeEach(() => {
    delete window.nodusDesktop;
    useAuthStore.setState({ user: { id: ME } as never });
  });

  it('в оболочке: попап с темой письма, letterId — цель, без ответа', async () => {
    const bridge = installBridge();
    notifyDesktopLetter(snapshot());
    await Promise.resolve();
    expect(bridge.showPopup).toHaveBeenCalledTimes(1);
    const payload = (bridge.showPopup.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.letterId).toBe(LETTER_ID);
    expect(payload.conversationId).toBeUndefined();
    expect(payload.title).toBe('Поступило письмо');
    expect(payload.preview).toBe('Договор подряда №15');
    expect(payload.canReply).toBe(false);
    expect(payload.urgent).toBe(false);
    expect(bridge.flashTaskbar).toHaveBeenCalledWith(false);
  });

  it('вне оболочки и чужие будила — тишина', () => {
    // Без window.nodusDesktop (браузер) — моста нет, зов тихий.
    notifyDesktopLetter(snapshot());
    // Оболочка есть, но уведомление чужое.
    const bridge = installBridge();
    notifyDesktopLetter(snapshot({ userId: OTHER }));
    expect(bridge.showPopup).not.toHaveBeenCalled();
  });

  it('не-почтовый kind — тишина (попапы остальных уведомлений не входят)', () => {
    const bridge = installBridge();
    notifyDesktopLetter(snapshot({ kind: 'task.completed' }));
    notifyDesktopLetter(snapshot({ kind: 'urgent.message' }));
    expect(bridge.showPopup).not.toHaveBeenCalled();
  });
});
