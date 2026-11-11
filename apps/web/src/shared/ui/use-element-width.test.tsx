// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useElementWidth } from './use-element-width.js';

/** Компонент карточки: сначала скелетон (элемента нет), после «загрузки» —
 *  измеряемая строка. Регрессия: хук вешался один раз до появления узла и
 *  навсегда возвращал 0 — solver сворачивал вторую область на широкой карточке. */
function Probe() {
  const rowRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const width = useElementWidth(rowRef);
  return (
    <div>
      <button type="button" onClick={() => setLoaded(true)}>
        load
      </button>
      <span data-testid="width">{width}</span>
      {loaded ? <div id="row" ref={rowRef} /> : null}
    </div>
  );
}

describe('useElementWidth', () => {
  it('подхватывает элемент, появившийся после первого маунта', async () => {
    // FLIP-анимация: rect масштабирован (320), layout-ширина — полная (640).
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 320 } as DOMRect);
    const offset = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
    render(<Probe />);
    expect(screen.getByTestId('width').textContent).toBe('0');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'load' }));
    });

    expect(screen.getByTestId('width').textContent).toBe('640');
    rect.mockRestore();
    offset.mockRestore();
  });
});
