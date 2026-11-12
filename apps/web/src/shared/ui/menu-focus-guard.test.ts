// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMenuFocusGuard } from './menu-focus-guard.js';

/** Гард возврата фокуса Radix-меню (#599): обычное закрытие отдаёт фокус
 *  триггеру, уход указателя в другое поле — нет. */
function closeEvent() {
  return { preventDefault: vi.fn() } as unknown as Event;
}

function pointerDown(button: number, ctrlKey = false) {
  return { detail: { originalEvent: { button, ctrlKey } } };
}

describe('useMenuFocusGuard (#599)', () => {
  it('обычное закрытие — возврат фокуса на триггер не отменяется', () => {
    const { result } = renderHook(() => useMenuFocusGuard());
    const event = closeEvent();

    result.current.contentProps.onCloseAutoFocus(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('указатель ушёл из меню — возврат фокуса отменяется', () => {
    const { result } = renderHook(() => useMenuFocusGuard());
    result.current.contentProps.onPointerDownOutside(pointerDown(0));
    const event = closeEvent();

    result.current.contentProps.onCloseAutoFocus(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('правый и ctrl-клик снаружи не помечаются — фокус решает Radix', () => {
    const { result } = renderHook(() => useMenuFocusGuard());

    result.current.contentProps.onPointerDownOutside(pointerDown(2));
    const right = closeEvent();
    result.current.contentProps.onCloseAutoFocus(right);

    result.current.contentProps.onPointerDownOutside(pointerDown(0, true));
    const ctrl = closeEvent();
    result.current.contentProps.onCloseAutoFocus(ctrl);

    expect(right.preventDefault).not.toHaveBeenCalled();
    expect(ctrl.preventDefault).not.toHaveBeenCalled();
  });

  it('переоткрытие меню сбрасывает отметку', () => {
    const { result } = renderHook(() => useMenuFocusGuard());
    result.current.contentProps.onPointerDownOutside(pointerDown(0));
    result.current.onOpenChange(true);
    const event = closeEvent();

    result.current.contentProps.onCloseAutoFocus(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
