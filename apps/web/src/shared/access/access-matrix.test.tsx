// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@nodus/ui/components/tooltip';

import { AccessMatrix } from './access-matrix.js';

// jsdom без ResizeObserver: подвод к краю (EdgeHints) его слушает.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;

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
});
