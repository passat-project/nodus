// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSplitWidth } from './use-split-width.js';

const KEY = 'test-split';

/** Фейковая колонка: родитель — контейнер карточки шириной 1200px. */
function fakePanel() {
  const style: Record<string, string> = {};
  const el = {
    style,
    parentElement: { getBoundingClientRect: () => ({ width: 1200 }) },
  };
  return { current: el as unknown as HTMLDivElement } as React.RefObject<HTMLDivElement | null>;
}

const pointer = (type: string, clientX: number) =>
  new MouseEvent(type, { clientX, bubbles: true }) as unknown as PointerEvent;

describe('useSplitWidth — перегородка карточки с памятью', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('дефолт — половина контейнера (доля, не px)', () => {
    const panel = fakePanel();
    const { result } = renderHook(() =>
      useSplitWidth(panel, { storeKey: KEY, min: 360, minOther: 420 }),
    );
    expect(result.current.width).toBeNull();
    expect(result.current.style).toEqual({ width: '50%' });
  });

  it('перетаскивание: ширина двигается, коммитится в память и переживает перемонтирование', () => {
    const panel = fakePanel();
    const first = renderHook(() =>
      useSplitWidth(panel, { storeKey: KEY, min: 360, minOther: 420 }),
    );
    act(() => {
      first.result.current.onDividerDown({
        preventDefault: () => undefined,
        clientX: 600,
      } as never);
      window.dispatchEvent(pointer('pointermove', 500));
      window.dispatchEvent(pointer('pointerup', 500));
    });
    expect(first.result.current.width).toBe(500);
    expect(localStorage.getItem(KEY)).toBe('500');

    const second = renderHook(() =>
      useSplitWidth(fakePanel(), { storeKey: KEY, min: 360, minOther: 420 }),
    );
    expect(second.result.current.width).toBe(500);
    expect(second.result.current.style).toEqual({ width: 500 });
  });

  it('минимумы: колонка не съедает вторую зону и не исчезает сама', () => {
    const panel = fakePanel();
    const { result } = renderHook(() =>
      useSplitWidth(panel, { storeKey: KEY, min: 360, minOther: 420 }),
    );
    act(() => {
      result.current.onDividerDown({ preventDefault: () => undefined, clientX: 600 } as never);
      window.dispatchEvent(pointer('pointermove', -400));
      window.dispatchEvent(pointer('pointerup', -400));
    });
    expect(result.current.width).toBe(360);

    act(() => {
      result.current.onDividerDown({ preventDefault: () => undefined, clientX: 600 } as never);
      window.dispatchEvent(pointer('pointermove', 2000));
      window.dispatchEvent(pointer('pointerup', 2000));
    });
    expect(result.current.width).toBe(780);
  });

  it('pointercancel завершает drag и снимает слушатели (#843)', () => {
    const panel = fakePanel();
    const { result } = renderHook(() =>
      useSplitWidth(panel, { storeKey: KEY, min: 360, minOther: 420 }),
    );
    act(() => {
      result.current.onDividerDown({ preventDefault: () => undefined, clientX: 600 } as never);
      window.dispatchEvent(pointer('pointermove', 500));
      window.dispatchEvent(pointer('pointercancel', 500));
    });
    expect(result.current.width).toBe(500);
    expect(result.current.dragging).toBe(false);

    // Слушатели сняты: курсор больше не тянет перегородку.
    act(() => {
      window.dispatchEvent(pointer('pointermove', 300));
    });
    expect(result.current.width).toBe(500);
  });
});
