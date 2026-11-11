// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardTabSplitter } from './card-tab-splitter.js';

function setup(overrides: Partial<Parameters<typeof CardTabSplitter>[0]> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const onReset = vi.fn();
  render(
    <CardTabSplitter
      leftW={400}
      totalW={800}
      minLeft={320}
      minRight={280}
      onChange={onChange}
      onCommit={onCommit}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onChange, onCommit, onReset, splitter: screen.getByRole('separator') };
}

function pointer(type: string, clientX: number) {
  return new PointerEvent(type, { clientX, bubbles: true, cancelable: true });
}

afterEach(cleanup);

describe('CardTabSplitter: перегородка областей', () => {
  it('aria-значения и позиция отражают ширину левой области', () => {
    const { splitter } = setup();
    expect(splitter.getAttribute('aria-valuenow')).toBe('400');
    expect(splitter.getAttribute('aria-valuemin')).toBe('320');
    // 800 - 280 = 520 — предел левой области.
    expect(splitter.getAttribute('aria-valuemax')).toBe('520');
  });

  it('drag двигает ширину и коммитит на pointerup', () => {
    const { onChange, onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 530));
    expect(onChange).toHaveBeenCalledWith(430);
    expect(onCommit).not.toHaveBeenCalled();
    window.dispatchEvent(pointer('pointerup', 530));
    expect(onCommit).toHaveBeenCalledWith(430);
  });

  it('drag ограничен минимумами и максимумом', () => {
    const { onChange, onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 100));
    expect(onChange).toHaveBeenLastCalledWith(320);
    window.dispatchEvent(pointer('pointermove', 900));
    expect(onChange).toHaveBeenLastCalledWith(520);
    window.dispatchEvent(pointer('pointerup', 900));
    expect(onCommit).toHaveBeenLastCalledWith(520);
  });

  it('pointercancel завершает тягу коммитом', () => {
    const { onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 510));
    window.dispatchEvent(pointer('pointercancel', 510));
    expect(onCommit).toHaveBeenCalledWith(410);
  });

  it('вторичная кнопка мыши не начинает тягу', () => {
    const { onChange, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 2, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 530));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('клавиатура: стрелки 8/24 px, Home/End, Enter — сброс', () => {
    const { onChange, onCommit, onReset, splitter } = setup();
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(392);
    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(408);
    fireEvent.keyDown(splitter, { key: 'ArrowRight', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(424);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onCommit).toHaveBeenLastCalledWith(320);
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(520);
    fireEvent.keyDown(splitter, { key: 'Enter' });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalled();
  });

  it('двойной клик сбрасывает 50/50', () => {
    const { onReset, splitter } = setup();
    fireEvent.doubleClick(splitter);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
