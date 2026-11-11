// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TWO_STATE,
  Harness,
  down,
  dispatchWindowPointer,
  flushFrame,
  installFrameControl,
  render,
  screen,
  twoAreas,
} from './use-card-tab-drag.test-helpers.js';

installFrameControl();
afterEach(cleanup);

describe('useCardTabDrag: решения drop по геометрии', () => {
  it('до порога движения drag не стартует и маркер не появляется', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 53, clientY: 20 });
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 53, clientY: 20 });
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByTestId('dragging').textContent).toBe('no');
    expect(screen.getByTestId('visual').textContent).toBe('');
  });

  it('перенос по полосе показывает слот вкладки и применяет reorder', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 250, clientY: 20 });
    flushFrame();
    expect(screen.getByTestId('dragging').textContent).toBe('yes');
    expect(screen.getByTestId('visual').textContent).toBe('A@250,20');
    // Слот после последней вкладки: x = правый край «c», ширина — вкладки.
    expect(screen.getByTestId('marker').textContent).toBe('tab:300');
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 250, clientY: 20 });
    expect(onResolve).toHaveBeenCalledWith({
      type: 'reorder',
      groupId: 'area-1',
      tabId: 'a',
      index: 3,
    });
    expect(screen.getByTestId('suppress').textContent).toBe('yes');
    expect(screen.getByTestId('visual').textContent).toBe('');
  });

  it('бросок за середину рабочей зоны показывает зону второй области и split', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 500, clientY: 300 });
    flushFrame();
    expect(screen.getByTestId('marker').textContent).toBe('area:402');
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 500, clientY: 300 });
    expect(onResolve).toHaveBeenCalledWith({
      type: 'split',
      groupId: 'area-1',
      tabId: 'a',
      side: 'right',
    });
  });

  it('бросок в контент другой области — move-end с зоной на всю область', () => {
    const onResolve = vi.fn();
    render(<Harness state={TWO_STATE} areas={twoAreas()} onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 600, clientY: 300 });
    flushFrame();
    expect(screen.getByTestId('marker').textContent).toBe('content:406');
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 600, clientY: 300 });
    expect(onResolve).toHaveBeenCalledWith({
      type: 'move-end',
      targetGroupId: 'area-2',
      tabId: 'a',
    });
  });

  it('бросок в контент своей области активирует вкладку', () => {
    const onResolve = vi.fn();
    render(<Harness state={TWO_STATE} areas={twoAreas()} onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 300, clientY: 300 });
    flushFrame();
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 300, clientY: 300 });
    expect(onResolve).toHaveBeenCalledWith({
      type: 'activate',
      groupId: 'area-1',
      tabId: 'a',
    });
  });
});
