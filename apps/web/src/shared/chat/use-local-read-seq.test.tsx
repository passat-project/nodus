// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import type { ChatMessage } from '@nodus/contracts';

// Внимание: водяной знак двигается только при реальном внимании (#770).
vi.mock('../attention/attention-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../attention/attention-store.js')>();
  return { ...actual, isUserActive: vi.fn(() => true) };
});

import { isUserActive } from '../attention/attention-store.js';
import { useLocalReadSeq } from './use-local-read-seq.js';

/**
 * Локальный знак прочтения ленты (#845): добавление у низа двигает его
 * синхронно, прокрутка вверх — нет, рефечи/темпы не сбивают. Главная
 * проверка — знак НЕ ждёт квитанций и списка бесед.
 */

const msg = (seq: number): ChatMessage => ({ id: `m-${seq}`, seq }) as ChatMessage;

/** Viewport с управляемой геометрией: jsdom не считает scrollHeight сам. */
function makeViewport() {
  const geometry = { scrollHeight: 1000, scrollTop: 500, clientHeight: 500 };
  const el = document.createElement('div');
  Object.defineProperties(el, {
    scrollHeight: { get: () => geometry.scrollHeight },
    clientHeight: { get: () => geometry.clientHeight },
    scrollTop: {
      get: () => geometry.scrollTop,
      set: (value: number) => (geometry.scrollTop = value),
    },
  });
  return { el, geometry };
}

function renderLocal(initialItems: ChatMessage[], initialEnabled = true) {
  const { el, geometry } = makeViewport();
  const utils = renderHook(
    ({ items, enabled }: { items: ChatMessage[]; enabled: boolean }) => {
      const viewportRef = useRef<HTMLElement | null>(el);
      return useLocalReadSeq({ items, viewportRef, enabled });
    },
    { initialProps: { items: initialItems, enabled: initialEnabled } },
  );
  const scrollTo = (scrollTop: number) => {
    geometry.scrollTop = scrollTop;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
  };
  return { ...utils, geometry, scrollTo };
}

beforeEach(() => {
  vi.mocked(isUserActive).mockReturnValue(true);
});

describe('useLocalReadSeq', () => {
  it('открытие у низа: знак сразу равен последнему сообщению', () => {
    const { result } = renderLocal([msg(1), msg(2), msg(3)]);
    expect(result.current.localReadSeq).toBe(3);
  });

  it('входящее у низа двигает знак до него', () => {
    const { result, rerender } = renderLocal([msg(1), msg(2)]);
    expect(result.current.localReadSeq).toBe(2);
    rerender({ items: [msg(1), msg(2), msg(3)], enabled: true });
    expect(result.current.localReadSeq).toBe(3);
  });

  it('прокрутился вверх — входящее знак не двигает', () => {
    const { result, rerender, scrollTo } = renderLocal([msg(1), msg(2)]);
    scrollTo(200); // 1000 - 200 - 500 > 32 — не у низа
    rerender({ items: [msg(1), msg(2), msg(3)], enabled: true });
    expect(result.current.localReadSeq).toBe(2);
  });

  it('якорь открытия (enabled=false): загрузка истории знак не двигает', () => {
    const { result, rerender } = renderLocal([msg(1), msg(2)], false);
    expect(result.current.localReadSeq).toBeNull();
    rerender({ items: [msg(1), msg(2), msg(3)], enabled: false });
    expect(result.current.localReadSeq).toBeNull();
    // Якорь встал, но старое добавление — не «новое на глазах».
    rerender({ items: [msg(1), msg(2), msg(3)], enabled: true });
    expect(result.current.localReadSeq).toBeNull();
    rerender({ items: [msg(1), msg(2), msg(3), msg(4)], enabled: true });
    expect(result.current.localReadSeq).toBe(4);
  });

  it('внимание пропало — добавление знак не двигает', () => {
    const { result, rerender } = renderLocal([msg(1), msg(2)]);
    vi.mocked(isUserActive).mockReturnValue(false);
    rerender({ items: [msg(1), msg(2), msg(3)], enabled: true });
    expect(result.current.localReadSeq).toBe(2);
  });

  it('темп отправки (seq = 0) не считается и не сбивает добавление', () => {
    const { result, rerender } = renderLocal([msg(1), msg(2)]);
    rerender({ items: [msg(1), msg(2), msg(0)], enabled: true });
    expect(result.current.localReadSeq).toBe(2);
    rerender({ items: [msg(1), msg(2), msg(3)], enabled: true });
    expect(result.current.localReadSeq).toBe(3);
  });

  it('markSeen двигает знак только вперёд и игнорирует null/0', () => {
    const { result } = renderLocal([msg(1)]);
    act(() => result.current.markSeen(9));
    expect(result.current.localReadSeq).toBe(9);
    act(() => result.current.markSeen(5));
    expect(result.current.localReadSeq).toBe(9);
    act(() => result.current.markSeen(null));
    expect(result.current.localReadSeq).toBe(9);
    act(() => result.current.markSeen(0));
    expect(result.current.localReadSeq).toBe(9);
  });
});
