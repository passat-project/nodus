// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DateTimePicker } from './date-time-picker.js';

describe('DateTimePicker: подпись триггера', () => {
  it('берёт время из value, а не из дефолтного состояния поповера', () => {
    render(
      <DateTimePicker
        value={new Date(2026, 10, 12, 9, 30)}
        onChange={() => vi.fn()}
        ariaLabel="Срок"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Срок' });
    expect(trigger.textContent).toContain('09:30');
    expect(trigger.textContent).not.toContain('17:00');
  });
});
