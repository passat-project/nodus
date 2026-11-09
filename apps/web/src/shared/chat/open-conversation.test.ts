// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireOpenConversation,
  getOpenConversation,
  resetOpenConversationRegistry,
} from './open-conversation.js';

/**
 * Реестр открытой беседы (#300): «текущая» — последний заявленный хост,
 * закрытие одного хоста не гасит беседу другого. Браузерных уведомлений в
 * вебе больше нет (#650) — этот реестр остаётся гейтом попапов оболочки.
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';

beforeEach(() => {
  resetOpenConversationRegistry();
});

afterEach(() => {
  delete (window as { nodusDesktop?: unknown }).nodusDesktop;
});

describe('реестр открытой беседы (#300)', () => {
  it('закрытие окна трэда не гасит открытую беседу', () => {
    const feed = acquireOpenConversation(CONV);
    const thread = acquireOpenConversation(CONV);
    expect(getOpenConversation()).toBe(CONV);
    // Анмаунт ОДНОГО хоста (окно треда) — беседа всё ещё открыта лентой.
    thread();
    expect(getOpenConversation()).toBe(CONV);
    feed();
    expect(getOpenConversation()).toBe(null);
    // Карточка поверх страницы: текущая — последняя заявленная.
    const page = acquireOpenConversation('00000000-0000-4000-8000-0000000000aa');
    const card = acquireOpenConversation(CONV);
    expect(getOpenConversation()).toBe(CONV);
    card();
    expect(getOpenConversation()).toBe('00000000-0000-4000-8000-0000000000aa');
    page();
    expect(getOpenConversation()).toBe(null);
  });

  it('открыл беседу в оболочке — попапы этой беседы гаснут (Telegram-модель)', () => {
    const dismissPopups = vi.fn(() => Promise.resolve());
    (window as { nodusDesktop?: unknown }).nodusDesktop = {
      shellVersion: '1.0.0',
      platform: 'windows',
      showPopup: () => Promise.resolve(),
      setUnreadBadge: () => Promise.resolve(),
      flashTaskbar: () => Promise.resolve(),
      openExternal: () => Promise.resolve(),
      setUiTheme: () => Promise.resolve(),
      dismissPopups,
      getShellInfo: () => Promise.resolve(),
      shellReady: () => Promise.resolve(),
      onEvent: () => () => undefined,
    };
    const release = acquireOpenConversation(CONV);
    expect(dismissPopups).toHaveBeenCalledWith(CONV);
    // Release хоста мост не дёргает.
    dismissPopups.mockClear();
    release();
    expect(dismissPopups).not.toHaveBeenCalled();
  });
});
