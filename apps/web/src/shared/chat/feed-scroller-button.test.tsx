// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode, RefObject } from 'react';

/** Стрелка «вниз» ленты (#845): цель — DOM-якорь плашки непрочитанных,
 *  пересчитывается резолвером каждый кадр; синк плашки — ДО чтения якоря. */

const { isVisible, jump } = vi.hoisted(() => ({
  isVisible: vi.fn(),
  jump: vi.fn(),
}));

vi.mock('./scroll-jump.js', () => ({
  isMessageFullyVisible: isVisible,
  scrollMessageIntoView: jump,
}));

vi.mock('@nodus/ui/components/message-scroller', () => ({
  MessageScrollerButton: ({
    onClick,
    children,
  }: {
    onClick: (event: { preventDefault: () => void }) => void;
    children: ReactNode;
  }) => (
    <button type="button" onClick={() => onClick({ preventDefault })}>
      {children}
    </button>
  ),
}));

const { FeedScrollerButton } = await import('./feed-scroller-button.js');

let prevented = 0;
function preventDefault(): void {
  prevented += 1;
}

function makeViewport(html: string): HTMLElement {
  const viewport = document.createElement('div');
  viewport.innerHTML = html;
  return viewport;
}

const ref = (viewport: HTMLElement | null): RefObject<HTMLElement | null> => ({
  current: viewport,
});

beforeEach(() => {
  isVisible.mockReset();
  isVisible.mockReturnValue(false);
  jump.mockReset();
  prevented = 0;
});

afterEach(cleanup);

describe('FeedScrollerButton', () => {
  it('беседа: цель — клетка плашки, взятого ПОСЛЕ синка (резолвер живой)', () => {
    const viewport = makeViewport('<div data-divider-for="m4"></div>');
    let synced = false;
    render(
      <FeedScrollerButton
        viewportRef={ref(viewport)}
        unreadCount={2}
        onBeforeNavigate={() => {
          synced = true;
          // Синк переставил плашку: старый узел отсыхает, в DOM — новый.
          viewport.innerHTML = '<div data-divider-for="m5"></div>';
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button'));

    expect(synced).toBe(true);
    expect(isVisible).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(1); // нативная «в конец» выключена
    expect(jump).toHaveBeenCalledTimes(1);
    const [resolver, container, options] = jump.mock.calls[0] as [
      () => HTMLElement | null,
      HTMLElement,
      { align: string; margin: number; behavior: string },
    ];
    expect(container).toBe(viewport);
    expect(options).toEqual({ align: 'start', margin: 8, behavior: 'smooth' });
    // Резолвер перезапрашивает якорь и ведёт к новому узлу, а не к захваченному.
    const fresh = viewport.firstElementChild as HTMLElement;
    expect(resolver()).toBe(fresh);
    viewport.innerHTML = '<div data-divider-for="m6"></div>';
    expect(resolver()).toBe(viewport.firstElementChild);
  });

  it('граница уже видна — скролла нет, работает штатная «в конец»', () => {
    isVisible.mockReturnValue(true);
    const viewport = makeViewport('<div data-divider-for="m4"></div>');
    render(<FeedScrollerButton viewportRef={ref(viewport)} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button'));
    expect(jump).not.toHaveBeenCalled();
    expect(prevented).toBe(0);
  });

  it('без плашки (канал/тред): цель — сообщение firstUnreadId с отступом 48', () => {
    const viewport = makeViewport('<div data-message-id="m7"></div>');
    render(<FeedScrollerButton viewportRef={ref(viewport)} firstUnreadId="m7" />);
    fireEvent.click(screen.getByRole('button'));
    expect(prevented).toBe(1);
    const [resolver, , options] = jump.mock.calls[0] as [
      () => HTMLElement | null,
      HTMLElement,
      { align: string; margin: number; behavior: string },
    ];
    expect(resolver()).toBe(viewport.firstElementChild);
    expect(options).toEqual({ align: 'start', margin: 48, behavior: 'smooth' });
  });

  it('цели нет (нет плашки и непрочитанных) — штатный скролл в конец', () => {
    const viewport = makeViewport('');
    render(<FeedScrollerButton viewportRef={ref(viewport)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(jump).not.toHaveBeenCalled();
    expect(prevented).toBe(0);
  });

  it('вьюпорта ещё нет (панель не смонтирована) — клик безопасен', () => {
    render(<FeedScrollerButton viewportRef={ref(null)} firstUnreadId="m7" />);
    fireEvent.click(screen.getByRole('button'));
    expect(jump).not.toHaveBeenCalled();
  });

  it('счётчик: 2 — цифра, 120 — «99+», 0 — бейджа нет', () => {
    const viewport = makeViewport('');
    const { rerender } = render(<FeedScrollerButton viewportRef={ref(viewport)} unreadCount={2} />);
    expect(screen.getByText('2')).toBeTruthy();
    rerender(<FeedScrollerButton viewportRef={ref(viewport)} unreadCount={120} />);
    expect(screen.getByText('99+')).toBeTruthy();
    rerender(<FeedScrollerButton viewportRef={ref(viewport)} unreadCount={0} />);
    expect(screen.queryByText('99+')).toBeNull();
  });
});
