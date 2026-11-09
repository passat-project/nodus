// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SEGMENTED_ACTIVE_TONAL, SegmentedControl } from './segmented-control.js';

afterEach(cleanup);

/**
 * #664: активный сегмент-«пилюля» переведён с литерала `bg-accent
 * text-foreground` на единый токен. В тёмной теме `--accent` (#1B1B1F) и фон
 * поповера (#17171A) дают 1.04:1 — выбранное состояние не читается; токен
 * подменяет фон на primary (3.81:1 к поповеру, подпись 4.51:1 — WCAG AA),
 * в светлой теме остаётся прежний accent. Тест сторожит возврат литерала и
 * неизменность дефолта (primary) у переключателей без тонального класса.
 */
describe('SegmentedControl (#664)', () => {
  it('тональный активный сегмент использует общий класс токена, а не accent-литерал', () => {
    render(
      <SegmentedControl
        value="a"
        options={[
          { value: 'a', label: 'Первый' },
          { value: 'b', label: 'Второй' },
        ]}
        onChange={vi.fn()}
        activeClassName={SEGMENTED_ACTIVE_TONAL}
      />,
    );

    const active = screen.getByRole('radio', { name: 'Первый' });
    const inactive = screen.getByRole('radio', { name: 'Второй' });

    expect(active.getAttribute('aria-checked')).toBe('true');
    expect(active.className).toContain('bg-segmented-active');
    expect(active.className).toContain('text-segmented-active-foreground');
    expect(active.className).not.toContain('bg-accent');
    expect(inactive.className).not.toContain('bg-segmented-active');
  });

  it('без activeClassName остаётся канонический primary', () => {
    render(
      <SegmentedControl
        value="a"
        options={[{ value: 'a', label: 'Один' }]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Один' }).className).toContain('bg-primary');
  });
});
