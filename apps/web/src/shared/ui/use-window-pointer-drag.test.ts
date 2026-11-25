// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWindowPointerDrag } from './use-window-pointer-drag.js';

/** Тяга с window-слушателями обязана сниматься сама (#1032): карточка может
 *  закрыться посреди drag, и осиротевший pointerup записал бы чужую ширину. */
const fire = (type: string) => act(() => void window.dispatchEvent(new Event(type)));

afterEach(cleanup);

describe('useWindowPointerDrag (#1032)', () => {
  it('pointerup завершает жест и снимает слушатели', () => {
    const { result } = renderHook(() => useWindowPointerDrag());
    const onMove = vi.fn();
    const onEnd = vi.fn();
    act(() => result.current({ onMove, onEnd }));

    fire('pointermove');
    expect(onMove).toHaveBeenCalledTimes(1);

    fire('pointerup');
    expect(onEnd).toHaveBeenCalledTimes(1);

    fire('pointermove');
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('размонтирование посреди жеста снимает слушатели', () => {
    const { result, unmount } = renderHook(() => useWindowPointerDrag());
    const onMove = vi.fn();
    const onEnd = vi.fn();
    act(() => result.current({ onMove, onEnd }));

    unmount();
    fire('pointermove');
    fire('pointerup');

    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('pointercancel завершает жест как отпускание', () => {
    const { result } = renderHook(() => useWindowPointerDrag());
    const onEnd = vi.fn();
    act(() => result.current({ onMove: vi.fn(), onEnd }));

    fire('pointercancel');

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
