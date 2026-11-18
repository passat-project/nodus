// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { DateTimePicker } from './date-time-picker.js';

afterEach(cleanup);

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

  it('full — дата с годом в подписи (день рождения, #923)', () => {
    render(
      <DateTimePicker
        value={new Date(1990, 0, 12)}
        onChange={() => vi.fn()}
        ariaLabel="Дата рождения"
        withTime={false}
        format="full"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Дата рождения' });
    expect(trigger.textContent).toContain('12.01.1990');
    expect(trigger.textContent).not.toContain('января');
  });
});

describe('DateTimePicker: выбор года (#923)', () => {
  it('шапка открывает сетку лет, выбор года возвращает календарь месяца', () => {
    render(
      <DateTimePicker
        value={new Date(1990, 0, 12)}
        onChange={() => vi.fn()}
        ariaLabel="Дата рождения"
        withTime={false}
        format="full"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Дата рождения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год' }));
    // Блок 1984–1999 (год значения — 1990).
    const year = screen.getByRole('button', { name: '1985' });
    fireEvent.click(year);
    // Вернулись к календарю: снова видны дни месяца, сетки лет нет.
    expect(screen.queryByRole('button', { name: '1985' })).toBeNull();
    expect(screen.getByRole('button', { name: '15' })).not.toBeNull();
  });
});
