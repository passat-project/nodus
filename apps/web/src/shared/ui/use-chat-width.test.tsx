// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useChatWidth } from './use-chat-width.js';

/** Перегородка карточки: память ширины + ПОТОЛОК (#750 — профиль слева не
 *  уже минимума данных): коммит на pointerup не копит «мертвый ход» — в
 *  память ложится эффективная ширина. */

const STORE_KEY = 'nodus-card-chat-w-v2';

function Probe({ ceiling }: { ceiling?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { chatW, onDividerDown } = useChatWidth(ref, 0, 420, ceiling);
  return (
    <div>
      <div ref={ref} data-testid="column" />
      <button type="button" data-testid="divider" onPointerDown={onDividerDown} />
      <span data-testid="width">{chatW}</span>
    </div>
  );
}

function drag(divider: HTMLElement, from: number, to: number) {
  act(() => {
    fireEvent.pointerDown(divider, { clientX: from });
  });
  act(() => {
    fireEvent.pointerMove(window, { clientX: to });
  });
  act(() => {
    fireEvent.pointerUp(window);
  });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('useChatWidth — потолок ширины колонки (#750)', () => {
  it('без потолка память берёт вытянутую ширину (клэмп вьюпорта)', () => {
    render(<Probe />);
    // jsdom: 1024 * 0.85 = 870 — предел вьюпорта.
    drag(screen.getByTestId('divider'), 500, 100);
    expect(screen.getByTestId('width').textContent).toBe('870');
    expect(localStorage.getItem(STORE_KEY)).toBe('870');
  });

  it('потолок съедает излишек: в память пишется эффективная ширина', () => {
    render(<Probe ceiling={700} />);
    drag(screen.getByTestId('divider'), 500, 100);
    expect(screen.getByTestId('width').textContent).toBe('700');
    expect(localStorage.getItem(STORE_KEY)).toBe('700');
  });
});
