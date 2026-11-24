// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DayBubble, labelAboveTop, type DayChipGeometry } from './day-bubble.js';
import { DayChip } from './day-chip.js';

/** Плавающая дата (#997): чистая геометрия + наблюдение за чипами ленты. */

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    left: 0,
    right: 600,
    width: 600,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

function Harness({ chips }: { chips: DayChipGeometry[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div
        data-testid="viewport"
        ref={(el) => {
          viewportRef.current = el;
          if (el) el.getBoundingClientRect = () => rect(0, 600);
        }}
      >
        {chips.map((chip) => (
          <div
            key={chip.label}
            data-day-chip=""
            data-day-label={chip.label}
            ref={(el) => {
              if (el) el.getBoundingClientRect = () => rect(chip.top, chip.bottom);
            }}
          />
        ))}
      </div>
      <DayBubble viewportRef={viewportRef} />
    </div>
  );
}

beforeEach(() => {
  // rAF-троттл хука: в jsdom без этого колбэк не дождётся — планируем в таймер.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('labelAboveTop', () => {
  it('пусто — даты нет', () => {
    expect(labelAboveTop([], 0)).toBeNull();
  });

  it('чип целиком выше кромки — дата показана', () => {
    expect(labelAboveTop([{ label: '5 сентября', top: -100, bottom: -76 }], 0)).toBe('5 сентября');
  });

  it('чип виден у кромки (даже частично) — не дублируем', () => {
    expect(labelAboveTop([{ label: '5 сентября', top: 16, bottom: 40 }], 0)).toBeNull();
    expect(labelAboveTop([{ label: '5 сентября', top: -10, bottom: 14 }], 0)).toBeNull();
  });

  it('берёт последний ушедший чип, следующий видимый не мешает', () => {
    expect(
      labelAboveTop(
        [
          { label: '5 сентября', top: -100, bottom: -76 },
          { label: '6 сентября', top: 10, bottom: 34 },
        ],
        0,
      ),
    ).toBe('5 сентября');
  });

  it('несколько ушедших — самая свежая дата', () => {
    expect(
      labelAboveTop(
        [
          { label: '5 сентября', top: -300, bottom: -276 },
          { label: '6 сентября', top: -50, bottom: -26 },
        ],
        0,
      ),
    ).toBe('6 сентября');
  });
});

describe('DayBubble', () => {
  it('показывает дату при открытии ленты внизу', async () => {
    render(<Harness chips={[{ label: '5 сентября', top: -320, bottom: -296 }]} />);
    expect(await screen.findByText('5 сентября')).toBeTruthy();
  });

  it('у начала истории обычный чип виден — плашки нет', () => {
    render(<Harness chips={[{ label: '5 сентября', top: 16, bottom: 40 }]} />);
    expect(screen.queryByText('5 сентября')).toBeNull();
  });

  it('на прокрутке меняет дату, когда чип уходит за кромку', async () => {
    const chips: DayChipGeometry[] = [
      { label: '5 сентября', top: -100, bottom: -76 },
      { label: '6 сентября', top: 200, bottom: 224 },
    ];
    render(<Harness chips={chips} />);
    expect(await screen.findByText('5 сентября')).toBeTruthy();

    chips[0]!.top = -300;
    chips[0]!.bottom = -276;
    chips[1]!.top = -50;
    chips[1]!.bottom = -26;
    fireEvent.scroll(screen.getByTestId('viewport'));

    expect(await screen.findByText('6 сентября')).toBeTruthy();
    expect(screen.queryByText('5 сентября')).toBeNull();
  });
});

describe('DayChip', () => {
  it('дата-чип помечается для плавающей даты, служебный маркер — нет', () => {
    const { container, rerender } = render(<DayChip label="5 сентября" />);
    const date = container.firstElementChild as HTMLElement;
    expect(date.getAttribute('data-day-chip')).toBe('');
    expect(date.getAttribute('data-day-label')).toBe('5 сентября');

    rerender(<DayChip label="Непрочитанные сообщения" kind="marker" />);
    const marker = container.firstElementChild as HTMLElement;
    expect(marker.hasAttribute('data-day-chip')).toBe(false);
    expect(marker.hasAttribute('data-day-label')).toBe(false);
  });
});
