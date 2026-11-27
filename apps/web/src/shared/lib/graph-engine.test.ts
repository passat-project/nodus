// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startGraph, type CompanyGraph } from './graph-engine.js';

/** #1035: живой граф анимируется ВСЕГДА — rAF-цикл и слушатели окна
 *  поднимаются независимо от системного «уменьшить движение». */

function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => gradient;
        }
        if (prop in target) return target[prop as keyof typeof target];
        return () => {};
      },
      set(target, prop, value) {
        (target as Record<string, unknown>)[prop as string] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    clientWidth: 800,
    clientHeight: 600,
    width: 0,
    height: 0,
    getContext: () => fakeCtx(),
  } as unknown as HTMLCanvasElement;
}

const graph: CompanyGraph = {
  nodes: [{ kind: 'person', r: 3, nx: 0.5, ny: 0.5 }],
  edges: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startGraph — движение при reduced-motion (#1035)', () => {
  it('rAF-цикл запущен и живёт после системного reduce', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => frames.splice(0));

    const stop = startGraph(fakeCanvas(), graph);
    expect(frames.length).toBeGreaterThan(0);
    frames.shift()?.(16);
    expect(frames.length).toBeGreaterThan(0);
    window.dispatchEvent(new Event('resize'));
    stop();
    expect(frames).toHaveLength(0);
  });
});
