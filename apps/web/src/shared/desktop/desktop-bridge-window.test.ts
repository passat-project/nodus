// @vitest-environment jsdom
import { COPY_TEXT_MAX_CHARS } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopCopyText,
  desktopWindowClose,
  desktopWindowIsMaximized,
  desktopWindowMinimize,
  desktopWindowStartDragging,
  desktopWindowToggleMaximize,
} from './desktop-bridge.js';

/**
 * Команды безрамочного окна и copyText (ADR-0055, #1038 фаза B2): методы
 * моста опциональны — установленная с системным заголовком оболочка их не
 * знает, вызовы молча пропускаются; лимит длины copyText — зеркало Rust.
 */

afterEach(() => {
  delete window.nodusDesktop;
});

/** Мост новой оболочки: только команды окна (прочие методы не при деле). */
function installWindowBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    shellVersion: '1.0.0',
    platform: 'windows',
    windowMinimize: vi.fn(async () => undefined),
    windowToggleMaximize: vi.fn(async () => undefined),
    windowClose: vi.fn(async () => undefined),
    windowStartDragging: vi.fn(async () => undefined),
    windowIsMaximized: vi.fn(async () => false),
    copyText: vi.fn(async () => undefined),
  };
  window.nodusDesktop = { ...bridge, ...overrides } as unknown as typeof window.nodusDesktop;
  return bridge;
}

describe('кнопки безрамочного окна (ADR-0055)', () => {
  it('в браузере и старой оболочке команды — тихие no-op', async () => {
    desktopWindowMinimize();
    desktopWindowToggleMaximize();
    desktopWindowClose();
    desktopWindowStartDragging();
    await expect(desktopCopyText('https://nodus.by')).resolves.toBe(false);
    await expect(desktopWindowIsMaximized()).resolves.toBeNull();

    // Оболочка с системным заголовком: методов нет — вызов молча пропускается.
    installWindowBridge({
      windowMinimize: undefined,
      windowToggleMaximize: undefined,
      windowClose: undefined,
      windowStartDragging: undefined,
      windowIsMaximized: undefined,
      copyText: undefined,
    });
    desktopWindowMinimize();
    desktopWindowClose();
    await expect(desktopCopyText('https://nodus.by')).resolves.toBe(false);
    await expect(desktopWindowIsMaximized()).resolves.toBeNull();
  });

  it('команды окна уходят в мост', () => {
    const bridge = installWindowBridge();
    desktopWindowMinimize();
    desktopWindowToggleMaximize();
    desktopWindowClose();
    desktopWindowStartDragging();
    expect(bridge.windowMinimize).toHaveBeenCalledTimes(1);
    expect(bridge.windowToggleMaximize).toHaveBeenCalledTimes(1);
    expect(bridge.windowClose).toHaveBeenCalledTimes(1);
    expect(bridge.windowStartDragging).toHaveBeenCalledTimes(1);
  });

  it('copyText: текст в пределах лимита копируется, сверх — молча нет', async () => {
    const bridge = installWindowBridge();
    await expect(desktopCopyText('https://nodus.by/home')).resolves.toBe(true);
    expect(bridge.copyText).toHaveBeenCalledWith('https://nodus.by/home');
    // Лимит — зеркало Rust copy_text: длинный текст не летит в мост.
    const long = 'a'.repeat(COPY_TEXT_MAX_CHARS + 1);
    await expect(desktopCopyText(long)).resolves.toBe(false);
    expect(bridge.copyText).toHaveBeenCalledTimes(1);
  });

  it('rejection моста не роняет вызовы (окно закрыто на глазах)', async () => {
    const bridge = installWindowBridge();
    bridge.copyText.mockRejectedValue(new Error('webview gone'));
    bridge.windowIsMaximized.mockRejectedValue(new Error('webview gone'));
    await expect(desktopCopyText('https://nodus.by')).resolves.toBe(false);
    await expect(desktopWindowIsMaximized()).resolves.toBeNull();
  });
});
