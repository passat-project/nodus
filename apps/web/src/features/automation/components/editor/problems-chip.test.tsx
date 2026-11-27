// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ProblemsChip } from './problems-chip.js';

vi.mock('@nodus/ui/components/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}));

const PROBLEM: WorkflowProblem = { code: 'no_initial', severity: 'error' };

afterEach(cleanup);

describe('чип проблем в баре рамы: три ступени ширины (#857)', () => {
  it('подпись уступает месту инструментам уже 1120px, счётчик — уже 680px; имя и title всегда полные', () => {
    render(<ProblemsChip problems={[PROBLEM]} onProblemClick={vi.fn()} />);
    const chip = screen.getByRole('button');
    const label = `${ui.automation.problemsChip} · 1`;
    expect(chip.getAttribute('aria-label')).toBe(label);
    expect(chip.getAttribute('title')).toBe(label);
    const [text, count] = chip.querySelectorAll('span');
    expect(text?.textContent).toBe(label);
    expect(text?.className).toBe('@max-[1120px]:hidden');
    // Условия счётчика не пересекаются с подписью: виден только между порогами.
    // Порог 680, а не 800: на рабочей ширине владельца (1536 → рама 766px)
    // счётчик «N» обязан читаться — знаки инструментов бара оставили место.
    expect(count?.textContent).toBe('1');
    expect(count?.className).toBe('inline @min-[1120px]:hidden @max-[680px]:hidden');
  });
});
