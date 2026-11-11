// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import type {
  CardTabAreaRect,
  CardTabsState,
  DropResolution,
  RectLike,
} from './card-tabs-model.js';
import { createCardTabsState } from './card-tabs-model.js';
import { useCardTabDrag } from './use-card-tab-drag.js';

export const WORK_AREA = { left: 0, top: 0, right: 800, bottom: 600 };

export function oneArea(): CardTabAreaRect[] {
  return [
    {
      groupId: 'area-1',
      strip: { left: 0, top: 0, right: 800, bottom: 40 },
      content: { left: 0, top: 40, right: 800, bottom: 600 },
      tabs: [
        { tabId: 'a', rect: { left: 0, top: 0, right: 100, bottom: 40 } },
        { tabId: 'b', rect: { left: 100, top: 0, right: 200, bottom: 40 } },
        { tabId: 'c', rect: { left: 200, top: 0, right: 300, bottom: 40 } },
      ],
    },
  ];
}

export function twoAreas(): CardTabAreaRect[] {
  return [
    {
      groupId: 'area-1',
      strip: { left: 0, top: 0, right: 400, bottom: 40 },
      content: { left: 0, top: 40, right: 400, bottom: 600 },
      tabs: [
        { tabId: 'a', rect: { left: 0, top: 0, right: 100, bottom: 40 } },
        { tabId: 'b', rect: { left: 100, top: 0, right: 200, bottom: 40 } },
        { tabId: 'c', rect: { left: 200, top: 0, right: 300, bottom: 40 } },
      ],
    },
    {
      groupId: 'area-2',
      strip: { left: 400, top: 0, right: 800, bottom: 40 },
      content: { left: 400, top: 40, right: 800, bottom: 600 },
      tabs: [{ tabId: 'd', rect: { left: 400, top: 0, right: 500, bottom: 40 } }],
    },
  ];
}

export const STATE: CardTabsState = createCardTabsState([
  { id: 'area-1', tabs: ['a', 'b', 'c'], active: 'a' },
]);

export const TWO_STATE: CardTabsState = createCardTabsState([
  { id: 'area-1', tabs: ['a', 'b', 'c'], active: 'a' },
  { id: 'area-2', tabs: ['d'], active: 'd' },
]);

/** Контролируемый requestAnimationFrame: кадр не крутит auto-scroll вечно. */
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

export function installFrameControl() {
  beforeEach(() => {
    frames = new Map();
    frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

export function flushFrame() {
  const batch = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of batch) callback(performance.now());
  });
}

function pointerEvent(
  type: string,
  init: { pointerId?: number; clientX?: number; clientY?: number },
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 7,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: 0,
  });
}

export function dispatchWindowPointer(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId?: number; clientX?: number; clientY?: number },
) {
  act(() => {
    window.dispatchEvent(pointerEvent(type, init));
  });
}

export function down({
  pointerId = 7,
  button = 0,
  testId = 'tab-a',
}: { pointerId?: number; button?: number; testId?: string } = {}) {
  fireEvent.pointerDown(screen.getByTestId(testId), {
    pointerId,
    button,
    clientX: 50,
    clientY: 20,
  });
}

export function Harness({
  state = STATE,
  areas = oneArea(),
  strips = [],
  onResolve,
  noDragTarget = false,
}: {
  state?: CardTabsState;
  areas?: CardTabAreaRect[];
  strips?: { el: HTMLElement; rect: RectLike }[];
  onResolve: (resolution: DropResolution) => void;
  noDragTarget?: boolean;
}) {
  const geometry = () => ({ areas, workArea: WORK_AREA, strips });
  const { start, cancel, visual, marker, dragging, suppressClick } = useCardTabDrag({
    state,
    labelOf: (tabId) => tabId.toUpperCase(),
    geometry,
    onResolve,
  });
  return (
    <div>
      <button
        type="button"
        data-testid="tab-a"
        onPointerDown={(event) => start('area-1', 'a', event, event.currentTarget)}
      >
        {noDragTarget ? (
          <span data-no-tab-drag data-testid="inner">
            Alpha
          </span>
        ) : (
          'Alpha'
        )}
      </button>
      <button type="button" data-testid="cancel" onClick={cancel}>
        Cancel
      </button>
      <output data-testid="visual">
        {visual ? `${visual.label}@${visual.x},${visual.y}` : ''}
      </output>
      <output data-testid="marker">{marker ? `${marker.kind}:${marker.x}` : ''}</output>
      <output data-testid="dragging">{dragging ? 'yes' : 'no'}</output>
      <output data-testid="suppress">{suppressClick() ? 'yes' : 'no'}</output>
    </div>
  );
}

export { render, screen };
