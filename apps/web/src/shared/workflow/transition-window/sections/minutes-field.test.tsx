// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { MinutesField } from './minutes-field.js';

afterEach(cleanup);

function mount(value: number | null, editable = true) {
  const onChange = vi.fn();
  render(<MinutesField value={value} editable={editable} onChange={onChange} />);
  return {
    onChange,
    input: screen.getByLabelText(ui.tasks.plannedTime) as HTMLInputElement,
  };
}

/**
 * «Плановое время» окна перехода (#994): неверный ввод не теряется и не
 * уходит на сервер; пустое поле — осознанная очистка; Esc возвращает прежнее.
 */
describe('MinutesField: плановое время окна перехода (#994)', () => {
  it('показывает текущее значение в деловой форме', () => {
    const { input } = mount(60);
    expect(input.value).toBe(`1 ${ui.tasks.hoursShort}`);
  });

  it('неверный ввод остаётся в поле, ошибка показана, значение не уходит', () => {
    const { onChange, input } = mount(60);

    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('abc');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(ui.tasks.minutesInvalid);
  });

  it('валидный ввод уходит минутами и нормализуется', () => {
    const { onChange, input } = mount(60);

    fireEvent.change(input, { target: { value: '1:30' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(90);
    expect(input.value).toBe(`1 ${ui.tasks.hoursShort} 30 ${ui.tasks.minutesShort}`);
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('пустое поле — очистка: null', () => {
    const { onChange, input } = mount(60);

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('Esc возвращает прежнее значение и снимает ошибку', () => {
    const { onChange, input } = mount(60);

    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe(`1 ${ui.tasks.hoursShort}`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('readOnly не применяет ввод', () => {
    const { onChange, input } = mount(60, false);

    fireEvent.change(input, { target: { value: '2ч' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
  });
});
