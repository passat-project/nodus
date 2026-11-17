// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import type { DepartmentLink } from '../lib/department-tree.js';
import { StructureTrace } from './structure-trace.js';

/** Пробег следа спуска (#768, §5): общий префикс не перепроходится, точка
 *  стартует от расхождения, точка и линия — один прогресс, предок — сразу
 *  закрашено. SVG-геометрия в jsdom заглушена; rAF и время — управляемые. */

const link = (parent: string, child: string): DepartmentLink => ({ parent, child });

const routes = [
  { parent: 'main', child: 'bim', d: 'M0 0 V100', length: 240 },
  { parent: 'bim', child: 'lab', d: 'M0 100 V200', length: 240 },
  { parent: 'lab', child: 'deep', d: 'M0 200 V300', length: 240 },
];

let now = 0;
let queue: FrameRequestCallback[] = [];

beforeAll(() => {
  Object.defineProperty(window.Element.prototype, 'getPointAtLength', {
    configurable: true,
    value(length: number) {
      return { x: length, y: 0 };
    },
  });
});

beforeEach(() => {
  now = 0;
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frames(ms: number) {
  now += ms;
  const due = queue;
  queue = [];
  act(() => {
    for (const callback of due) callback(now);
  });
}

const paths = () => Array.from(document.querySelectorAll('[data-trace-edge]')) as SVGPathElement[];
const dot = () => document.querySelector('[data-trace-dot]') as SVGCircleElement | null;
const offsets = () => paths().map((path) => path.style.strokeDashoffset);

describe('StructureTrace (#768)', () => {
  it('первый пробег: весь маршрут красится, точка видна и гаснет в конце', () => {
    render(
      <svg>
        <StructureTrace routes={routes} trail={[link('main', 'bim')]} runKey="k1" />
      </svg>,
    );
    expect(offsets()).toEqual(['1']);

    frames(16);
    expect(Number.parseFloat(offsets()[0]!)).toBeLessThan(1);
    expect(dot()?.style.opacity).toBe('1');

    frames(500);
    expect(offsets()).toEqual(['0']);
    expect(dot()?.style.opacity).toBe('0');
  });

  it('спуск глубже: общий префикс закрашен сразу, точка бежит только хвост', () => {
    const view = render(
      <svg>
        <StructureTrace routes={routes} trail={[link('main', 'bim')]} runKey="k1" />
      </svg>,
    );
    frames(500);

    view.rerender(
      <svg>
        <StructureTrace
          routes={routes}
          trail={[link('main', 'bim'), link('bim', 'lab')]}
          runKey="k2"
        />
      </svg>,
    );
    expect(offsets()).toEqual(['0', '1']);

    frames(16);
    expect(dot()?.style.opacity).toBe('1');
    // Точка и линия — один прогресс: точка ровно на конце закрашенной части.
    const offset = Number.parseFloat(offsets()[1]!);
    expect(Number.parseFloat(dot()?.getAttribute('cx') ?? '0')).toBeCloseTo((1 - offset) * 240, 0);

    frames(500);
    expect(offsets()).toEqual(['0', '0']);
  });

  it('выбран предок: точки нет, маршрут закрашен сразу', () => {
    const view = render(
      <svg>
        <StructureTrace
          routes={routes}
          trail={[link('main', 'bim'), link('bim', 'lab')]}
          runKey="k1"
        />
      </svg>,
    );
    frames(600);

    view.rerender(
      <svg>
        <StructureTrace routes={routes} trail={[link('main', 'bim')]} runKey="k2" />
      </svg>,
    );
    expect(offsets()).toEqual(['0']);
    expect(dot()?.style.opacity).toBe('0');
    expect(queue.length).toBe(0);
  });

  it('prefers-reduced-motion: след закрашивается сразу, без точки', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(
      <svg>
        <StructureTrace routes={routes} trail={[link('main', 'bim')]} runKey="k1" />
      </svg>,
    );
    expect(offsets()).toEqual(['0']);
    expect(dot()?.style.opacity).toBe('0');
    expect(queue.length).toBe(0);
  });

  it('геометрия ещё не измерена — след не рисуется (половину не красим)', () => {
    render(
      <svg>
        <StructureTrace routes={[]} trail={[link('main', 'bim')]} runKey="k1" />
      </svg>,
    );
    expect(paths()).toHaveLength(0);
    expect(dot()).toBeNull();
  });
});
