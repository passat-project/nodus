// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardDataSplitter } from './card-data-splitter.js';

function setup({ width = 400, withRef = true }: { width?: number; withRef?: boolean } = {}) {
  const div = document.createElement('div');
  div.getBoundingClientRect = () => ({ width }) as DOMRect;
  const dataRef = { current: withRef ? div : null };
  const onCommit = vi.fn();
  const onReset = vi.fn();
  render(
    <CardDataSplitter
      dataRef={dataRef}
      dataW={400}
      max={560}
      onCommit={onCommit}
      onReset={onReset}
    />,
  );
  return { div, onCommit, onReset, splitter: screen.getByRole('separator') };
}

function pointer(type: string, clientX: number) {
  return new PointerEvent(type, { clientX, bubbles: true, cancelable: true });
}

afterEach(cleanup);

describe('CardDataSplitter: панель данных | области вкладок', () => {
  it('aria-значения отражают ширину и границы', () => {
    const { splitter } = setup();
    expect(splitter.getAttribute('aria-valuenow')).toBe('400');
    expect(splitter.getAttribute('aria-valuemin')).toBe('320');
    expect(splitter.getAttribute('aria-valuemax')).toBe('560');
  });

  it('drag пишет ширину императивно и коммитит округлённую на pointerup', () => {
    const { div, onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 527.6));
    expect(div.style.width).toBe('427.6px');
    expect(div.style.minWidth).toBe('427.6px');
    expect(onCommit).not.toHaveBeenCalled();
    window.dispatchEvent(pointer('pointerup', 527.6));
    expect(onCommit).toHaveBeenCalledWith(428);
  });

  it('drag зажимается полом и потолком', () => {
    const { onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 0));
    window.dispatchEvent(pointer('pointerup', 0));
    expect(onCommit).toHaveBeenLastCalledWith(320);

    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 999));
    window.dispatchEvent(pointer('pointerup', 999));
    expect(onCommit).toHaveBeenLastCalledWith(560);
  });

  it('pointercancel коммитит последнюю ширину', () => {
    const { onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 510));
    window.dispatchEvent(pointer('pointercancel', 510));
    expect(onCommit).toHaveBeenCalledWith(410);
  });

  it('без ref тяга не начинается', () => {
    const { onCommit, splitter } = setup({ withRef: false });
    fireEvent.pointerDown(splitter, { button: 0, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 530));
    window.dispatchEvent(pointer('pointerup', 530));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('вторичная кнопка мыши не начинает тягу', () => {
    const { onCommit, splitter } = setup();
    fireEvent.pointerDown(splitter, { button: 2, clientX: 500 });
    window.dispatchEvent(pointer('pointermove', 530));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('клавиатура: стрелки 8/24 px, Home/End, Enter — сброс', () => {
    const { onCommit, onReset, splitter } = setup();
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(392);
    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(408);
    fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(376);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onCommit).toHaveBeenLastCalledWith(320);
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(560);
    fireEvent.keyDown(splitter, { key: 'Enter' });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('двойной клик сбрасывает ширину по умолчанию', () => {
    const { onReset, splitter } = setup();
    fireEvent.doubleClick(splitter);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
