// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TimePicker } from './time-picker.js';

afterEach(cleanup);

/** Выбор времени в стиле Nodus (#923): поле-триггер → поповер с точным
 *  вводом и сеткой слотов; никаких нативных `type="time"`. */
describe('TimePicker (#923)', () => {
  it('триггер показывает значение или «Не задано»', () => {
    const { rerender } = render(
      <TimePicker value="09:00" onChange={vi.fn()} ariaLabel="Начало рабочего дня" />,
    );
    expect(screen.getByRole('button', { name: 'Начало рабочего дня' }).textContent).toContain(
      '09:00',
    );

    rerender(<TimePicker value={null} onChange={vi.fn()} ariaLabel="Начало рабочего дня" />);
    expect(screen.getByRole('button', { name: 'Начало рабочего дня' }).textContent).toContain(
      'Не задано',
    );
  });

  it('открывает сетку, клик по слоту отдаёт время и закрывает', () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:00" onChange={onChange} ariaLabel="Начало рабочего дня" />);

    fireEvent.click(screen.getByRole('button', { name: 'Начало рабочего дня' }));
    const slot = screen.getByRole('button', { name: '10:15' });
    fireEvent.click(slot);

    expect(onChange).toHaveBeenCalledWith('10:15');
    expect(screen.queryByRole('button', { name: '10:15' })).toBeNull();
  });

  it('точный ввод без ведущего нуля: «945» → 09:45, Enter коммитит', () => {
    const onChange = vi.fn();
    render(<TimePicker value={null} onChange={onChange} ariaLabel="Начало рабочего дня" />);

    fireEvent.click(screen.getByRole('button', { name: 'Начало рабочего дня' }));
    const input = screen.getByLabelText('Время') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '945' } });
    expect(input.value).toBe('9:45');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('09:45');
  });

  it('невалидный ввод не коммитится', () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:00" onChange={onChange} ariaLabel="Начало рабочего дня" />);

    fireEvent.click(screen.getByRole('button', { name: 'Начало рабочего дня' }));
    const input = screen.getByLabelText('Время') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('09:00');
  });

  it('крестик очищает значение', () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:00" onChange={onChange} ariaLabel="Начало рабочего дня" />);

    const clear = screen.getByRole('button', { name: 'Сбросить' });
    fireEvent.click(clear);

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
