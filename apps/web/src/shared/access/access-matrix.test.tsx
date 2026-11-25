// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@nodus/ui/components/tooltip';

import { uiPx } from '../ui/ui-scale.js';
import { AccessMatrix } from './access-matrix.js';

// jsdom без ResizeObserver: подвод к краю (EdgeHints) его слушает.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;

afterEach(cleanup);

/** #724: левая колонка прав — единый липкий блок без зазора и просвечивания. */
describe('AccessMatrix: липкая колонка прав (#724)', () => {
  it('колонка — sticky left-0 с непрозрачным фоном и разделителем, группа — тоже', () => {
    render(
      <TooltipProvider>
        <AccessMatrix
          label="Матрица"
          rowHeader="Право"
          rows={[
            { id: 'r1', label: 'Право 1', description: 'Описание' },
            { id: 'r2', label: 'Право 2', description: 'Описание', group: 'Группа' },
          ]}
          columns={[
            { id: 'c1', name: 'Роль 1' },
            { id: 'c2', name: 'Роль 2' },
          ]}
          cell={() => ({ granted: false, disabled: false })}
          onToggle={() => void 0}
          cellLabel={() => 'переключатель'}
        />
      </TooltipProvider>,
    );

    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders.length).toBeGreaterThan(0);
    for (const header of rowHeaders) {
      expect(header.className).toContain('sticky');
      expect(header.className).toContain('left-0');
      expect(header.className).toContain('bg-card');
      expect(header.className).not.toMatch(/bg-card\//);
      expect(header.className).toContain('border-r');
    }
    // Заголовок группы — липкий по той же левой кромке.
    const group = screen.getByText('Группа');
    const groupCell = group.closest('[role="columnheader"]')!;
    expect(groupCell.className).toContain('sticky');
    expect(groupCell.className).toContain('left-0');
  });

  it('левая подсказка прокрутки — на правом краю закреплённой колонки (#1006)', () => {
    render(
      <TooltipProvider>
        <AccessMatrix
          label="Матрица"
          rowHeader="Право"
          rows={[{ id: 'r1', label: 'Право 1', description: 'Описание' }]}
          columns={[
            { id: 'c1', name: 'Роль 1' },
            { id: 'c2', name: 'Роль 2' },
            { id: 'c3', name: 'Роль 3' },
          ]}
          cell={() => ({ granted: false, disabled: false })}
          onToggle={() => void 0}
          cellLabel={() => 'переключатель'}
        />
      </TooltipProvider>,
    );
    const table = screen.getByRole('table');
    // jsdom не считает layout: задаём прокрутку, при которой есть куда листать.
    Object.defineProperties(table, {
      clientWidth: { configurable: true, value: 800 },
      scrollWidth: { configurable: true, value: 2000 },
      scrollLeft: { configurable: true, value: 400 },
    });
    fireEvent.scroll(table);

    const leftHint = document.querySelector<HTMLElement>('[data-edge-hint="left"]')!;
    expect(leftHint.style.left).toBe(`${uiPx(360)}px`);
  });
});
