// @vitest-environment jsdom
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCanvasView } from './use-canvas-view.js';

/** Жесты канваса структуры (#768): Ctrl+колесо — зум, колесо — панорама,
 *  зажатая ЛКМ по пустому месту — перетаскивание. */

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const { view, handlers } = useCanvasView(ref);
  return (
    <div
      ref={ref}
      data-testid="canvas"
      data-zoom={view.zoom}
      data-x={view.x}
      data-y={view.y}
      {...handlers}
    />
  );
}

function ProbeWithPortal() {
  const ref = useRef<HTMLDivElement>(null);
  const { view, handlers } = useCanvasView(ref);
  return (
    <div ref={ref} data-testid="portal-canvas" data-x={view.x} data-y={view.y} {...handlers}>
      {createPortal(<div data-testid="portal-item" />, document.body)}
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('useCanvasView (#768)', () => {
  it('Ctrl+колесо приближает, обычное колесо двигает полотно', () => {
    render(<Probe />);
    const canvas = screen.getByTestId('canvas');

    fireEvent.wheel(canvas, { deltaY: -200, ctrlKey: true });
    expect(Number(canvas.dataset.zoom)).toBeGreaterThan(1);

    fireEvent.wheel(canvas, { deltaY: 30, deltaX: 10 });
    expect(canvas.dataset.x).toBe('-10');
    expect(canvas.dataset.y).toBe('-30');
  });

  it('ЛКМ по пустому месту перемещает полотно, клик по карточке — нет', () => {
    render(<Probe />);
    const canvas = screen.getByTestId('canvas');

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
    expect(canvas.dataset.x).toBe('50');
    expect(canvas.dataset.y).toBe('30');

    // Карточка дерева — не зона панорамы (клик остаётся её собственным действием).
    const card = document.createElement('button');
    card.setAttribute('data-tree-node', 'x');
    canvas.append(card);
    fireEvent.pointerDown(card, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 100, clientY: 100 });
    expect(canvas.dataset.x).toBe('50');
  });

  it('портал (меню «⋯» карточки) не начинает панораму и не забирает клик', () => {
    render(<ProbeWithPortal />);
    const canvas = screen.getByTestId('portal-canvas');
    const item = screen.getByTestId('portal-item');

    fireEvent.pointerDown(item, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 3, clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 3, clientX: 80, clientY: 60 });

    expect(canvas.dataset.x).toBe('0');
    expect(canvas.dataset.y).toBe('0');
  });
});
