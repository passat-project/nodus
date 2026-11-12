// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindDesktopShellEvents,
  desktopApplyUpdate,
  desktopDismissPopups,
  desktopLogPopupDecision,
  desktopSetUnreadBadge,
  desktopShowPopup,
  getDesktopBridge,
  getShellUpdateState,
  isDesktopShell,
} from './desktop-bridge.js';
import {
  getAttention,
  isUserActive,
  isWindowAttentive,
  resetAttentionForTests,
  startAttentionTracking,
} from '../attention/attention-store.js';

/**
 * Протокол моста «портал ↔ оболочка» (ADR-0019): обнаружение, zod-фильтр
 * команд на границе, события видимости, сигнал готовности. Фейковый
 * window.nodusDesktop повторяет сигнатуру инициализационного скрипта
 * (apps/desktop/src-tauri/src/bridge.rs) — рассинхрон = тест падает.
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const LETTER = '00000000-0000-4000-8000-0000000000e1';

function installBridge() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const bridge = {
    shellVersion: '1.0.0',
    platform: 'windows',
    showPopup: vi.fn(async () => undefined),
    logPopupDecision: vi.fn(async () => undefined),
    setUnreadBadge: vi.fn(async () => undefined),
    flashTaskbar: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    dismissPopups: vi.fn(async () => undefined),
    setUiTheme: vi.fn(async () => undefined),
    getShellInfo: vi.fn(async () => ({ version: '1.0.0', platform: 'windows' })),
    getUpdateState: vi.fn(async (): Promise<{ status: string; version: string | null }> => ({
      status: 'idle',
      version: null,
    })),
    applyUpdate: vi.fn(async () => undefined),
    shellReady: vi.fn(async () => undefined),
    onEvent: vi.fn((type: string, fn: (payload: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
      return () => {
        const cur = listeners.get(type) ?? [];
        listeners.set(
          type,
          cur.filter((f) => f !== fn),
        );
      };
    }),
  };
  window.nodusDesktop = bridge;
  const emit = (type: string, payload: unknown) =>
    (listeners.get(type) ?? []).forEach((fn) => fn(payload));
  return { bridge, emit };
}

beforeEach(() => {
  delete window.nodusDesktop;
  resetAttentionForTests();
});

afterEach(() => {
  delete window.nodusDesktop;
  resetAttentionForTests();
});

describe('обнаружение моста', () => {
  it('в браузере моста нет и все вызовы — тихие no-op', async () => {
    expect(isDesktopShell()).toBe(false);
    expect(getDesktopBridge()).toBeNull();
    await expect(desktopShowPopup({})).resolves.toBe('unavailable');
    await expect(desktopSetUnreadBadge(5)).resolves.toBeUndefined();
  });

  it('в оболочке мост обнаруживается', () => {
    installBridge();
    expect(isDesktopShell()).toBe(true);
  });
});

describe('команды на границе', () => {
  it('showPopup пропускает только контрактный payload', async () => {
    const { bridge } = installBridge();
    await expect(
      desktopShowPopup({
        id: 'm1',
        conversationId: CONV,
        title: 'Иван Петров',
        preview: 'Привет',
        urgent: false,
        canReply: true,
      }),
    ).resolves.toBe('sent');
    // Мусор — молча отбрасывается, но вызывающий видит причину (#811).
    await expect(desktopShowPopup({ id: '', title: 42 })).resolves.toBe('invalid');
    expect(bridge.showPopup).toHaveBeenCalledTimes(1);
  });

  it('лог диагностики: только id/коды из закрытого списка причин (#811)', () => {
    const { bridge } = installBridge();
    desktopLogPopupDecision({ messageId: 'm1', conversationId: CONV, reason: 'looking' });
    expect(bridge.logPopupDecision).toHaveBeenCalledWith({
      messageId: 'm1',
      conversationId: CONV,
      reason: 'looking',
    });
    // Неизвестная причина/чужой тип — в лог оболочки не уходят.
    desktopLogPopupDecision({ messageId: null, conversationId: null, reason: 'hack\n' });
    desktopLogPopupDecision({ messageId: 42, conversationId: null, reason: 'sent' });
    expect(bridge.logPopupDecision).toHaveBeenCalledTimes(1);
  });

  it('старая оболочка без команды диагностики: молча пропускает, не бросает (#811)', () => {
    installBridge();
    const bridge = window.nodusDesktop as unknown as Record<string, unknown>;
    delete bridge.logPopupDecision;
    expect(() =>
      desktopLogPopupDecision({ messageId: null, conversationId: null, reason: 'sent' }),
    ).not.toThrow();
  });

  it('бейдж передаёт счётчик и null-сброс', async () => {
    const { bridge } = installBridge();
    await desktopSetUnreadBadge(7);
    await desktopSetUnreadBadge(null);
    expect(bridge.setUnreadBadge).toHaveBeenNthCalledWith(1, 7);
    expect(bridge.setUnreadBadge).toHaveBeenNthCalledWith(2, null);
  });

  it('dismissPopups передаёт беседу (открыл чат — его попапы гаснут)', async () => {
    const { bridge } = installBridge();
    await desktopDismissPopups(CONV);
    expect(bridge.dismissPopups).toHaveBeenCalledWith(CONV);
  });

  it('состояние обновления фильтруется контрактом (#263)', async () => {
    const { bridge } = installBridge();
    bridge.getUpdateState.mockResolvedValue({ status: 'available', version: '1.0.1' });
    expect(await getShellUpdateState()).toEqual({ status: 'available', version: '1.0.1' });

    bridge.getUpdateState.mockResolvedValue({ status: 'weird', version: null });
    expect(await getShellUpdateState()).toBeNull();

    delete window.nodusDesktop;
    expect(await getShellUpdateState()).toBeNull();
  });

  it('applyUpdate: успех — истина, сбой/браузер — ложь', async () => {
    const { bridge } = installBridge();
    expect(await desktopApplyUpdate()).toBe(true);
    expect(bridge.applyUpdate).toHaveBeenCalledTimes(1);

    bridge.applyUpdate.mockRejectedValue(new Error('update-not-ready'));
    expect(await desktopApplyUpdate()).toBe(false);

    delete window.nodusDesktop;
    expect(await desktopApplyUpdate()).toBe(false);
  });
});

describe('видимость и фокус оболочки (#770)', () => {
  it('до bind события видимости не меняют состояние (подписка — через bind)', () => {
    const { emit } = installBridge();
    emit('shell-visibility', { visible: false });
    expect(getAttention().shellVisible).toBe(true);
  });

  it('bind слушает события и фильтрует кривые payload', () => {
    const { emit } = installBridge();
    const onReply = vi.fn();
    const onOpen = vi.fn();
    const onLetter = vi.fn();
    const un = bindDesktopShellEvents({
      onPopupReply: onReply,
      onOpenConversation: onOpen,
      onOpenLetter: onLetter,
    });

    emit('popup-reply', { id: 'm1', conversationId: CONV, text: 'Ответ' });
    emit('popup-reply', { id: 'm2', conversationId: 'не-uuid', text: 'мусор' });
    emit('open-conversation', { conversationId: CONV });
    // Письмо (#618): валидный letterId проходит, мусор фильтруется.
    emit('open-letter', { letterId: LETTER });
    emit('open-letter', { letterId: 'не-uuid' });
    emit('shell-visibility', { visible: false });
    emit('shell-visibility', 'не объект');

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({ conversationId: CONV });
    expect(onLetter).toHaveBeenCalledTimes(1);
    expect(onLetter).toHaveBeenCalledWith({ letterId: LETTER });
    expect(isWindowAttentive()).toBe(false); // трей — не внимание

    emit('shell-visibility', { visible: true });
    expect(isWindowAttentive()).toBe(true);

    // Фокус/свёрнутость (#770): событие оболочки переключает модель.
    emit('shell-focus', { focused: false });
    expect(isWindowAttentive()).toBe(false);
    expect(isUserActive()).toBe(false);
    emit('shell-focus', { focused: true });
    expect(isWindowAttentive()).toBe(true);
    emit('shell-focus', 'не объект');

    un();
    emit('popup-reply', { id: 'm3', conversationId: CONV, text: 'после отписки' });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('bind сигналит оболочке shellReady', () => {
    const { bridge } = installBridge();
    bindDesktopShellEvents({
      onPopupReply: vi.fn(),
      onOpenConversation: vi.fn(),
      onOpenLetter: vi.fn(),
    });
    expect(bridge.shellReady).toHaveBeenCalled();
  });
});

describe('фон документа', () => {
  it('скрытая вкладка — не внимание (visibilitychange → модель)', () => {
    installBridge();
    startAttentionTracking();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isWindowAttentive()).toBe(false);
    hidden.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isWindowAttentive()).toBe(true);
    vi.restoreAllMocks();
    resetAttentionForTests();
  });
});
