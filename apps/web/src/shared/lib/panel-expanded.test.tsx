// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PanelExpandedContext, usePanelExpanded } from './panel-expanded.js';

function Probe() {
  return <span data-testid="probe">{usePanelExpanded() ? 'expanded' : 'collapsed'}</span>;
}

afterEach(cleanup);

describe('PanelExpandedContext — холсты монтируются вне scale-анимации панели (#857)', () => {
  it('вне панели значение сразу «раскрыта»: рабочая область и окна не ждут', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('expanded');
  });

  it('внутри раскрывающейся панели — ещё «не раскрыта», холст не монтируется', () => {
    render(
      <PanelExpandedContext.Provider value={false}>
        <Probe />
      </PanelExpandedContext.Provider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('collapsed');
  });
});
