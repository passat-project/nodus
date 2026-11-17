// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { AssistantBypassButton, BYPASS_LONG_PRESS_MS } from './assistant-bypass-button.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe('AssistantBypassButton: только долгое нажатие (ADR-0048)', () => {
  it('короткий клик режим не включает', () => {
    const toggle = vi.fn();
    render(<AssistantBypassButton active={false} onToggle={toggle} />);
    const button = screen.getByRole('button', { name: ui.assistant.bypassTitle });

    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(BYPASS_LONG_PRESS_MS - 50);
    fireEvent.pointerUp(button);
    fireEvent.click(button);

    expect(toggle).not.toHaveBeenCalled();
  });

  it('зажатие ≥ 400 мс переключает ровно один раз', () => {
    const toggle = vi.fn();
    render(<AssistantBypassButton active={false} onToggle={toggle} />);
    const button = screen.getByRole('button', { name: ui.assistant.bypassTitle });

    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(BYPASS_LONG_PRESS_MS);
    fireEvent.pointerUp(button);
    fireEvent.click(button); // клик после жеста — часть того же нажатия

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('активное состояние видно и озвучено', () => {
    render(<AssistantBypassButton active onToggle={() => undefined} />);
    const button = screen.getByRole('button', { name: ui.assistant.bypassTitle });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe(ui.assistant.bypassActiveHint);
  });

  it('уход курсора до порога отменяет срабатывание', () => {
    const toggle = vi.fn();
    render(<AssistantBypassButton active={false} onToggle={toggle} />);
    const button = screen.getByRole('button', { name: ui.assistant.bypassTitle });

    fireEvent.pointerDown(button);
    fireEvent.pointerLeave(button);
    vi.advanceTimersByTime(BYPASS_LONG_PRESS_MS * 2);

    expect(toggle).not.toHaveBeenCalled();
  });
});
