// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';

import { useActiveOption } from './use-active-option.js';

function keyEvent(key: string): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('useActiveOption: Enter только для открытого списка', () => {
  it('закрытый список не выбирает первый вариант', () => {
    const { result } = renderHook(() => useActiveOption(3, 'closed'));
    const onPick = vi.fn();

    const handled = result.current.onKeyDown(keyEvent('Enter'), { onPick, enabled: false });

    expect(handled).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('открытый список выбирает подсвеченный вариант', () => {
    const { result } = renderHook(() => useActiveOption(3, 'open'));
    const onPick = vi.fn();

    const handled = result.current.onKeyDown(keyEvent('Enter'), { onPick, enabled: true });

    expect(handled).toBe(true);
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it('стрелки по-прежнему открывают список и двигают подсветку', () => {
    const { result } = renderHook(() => useActiveOption(3, 'arrows'));
    const onOpen = vi.fn();

    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown'), {
        onPick: vi.fn(),
        onOpen,
        enabled: false,
      });
    });

    expect(onOpen).toHaveBeenCalled();
    expect(result.current.active).toBe(1);
  });
});
