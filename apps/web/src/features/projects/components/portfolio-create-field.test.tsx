// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { PortfolioCreateField } from './portfolio-create-field.js';

/** Инлайн-создание портфеля (#559): Enter создаёт, Esc/blur с пустым — нет,
 *  повторный вызов строки (Enter + blur) не создаёт две папки. */
function field() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<PortfolioCreateField onSubmit={onSubmit} onCancel={onCancel} />);
  const input = screen.getByRole('textbox', { name: ui.projects.portfolioCreate });
  return { onSubmit, onCancel, input };
}

afterEach(cleanup);

describe('PortfolioCreateField (#559)', () => {
  it('Enter с именем создаёт папку (имя обрезается)', () => {
    const { onSubmit, input } = field();

    fireEvent.change(input, { target: { value: '  Новый портфель  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('Новый портфель');
  });

  it('пустое имя — отмена, а не пустая папка', () => {
    const { onSubmit, onCancel, input } = field();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Esc отменяет ввод', () => {
    const { onSubmit, onCancel, input } = field();

    fireEvent.change(input, { target: { value: 'Не сохранять' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('уход из поля создаёт папку (Enter + blur — одно создание)', () => {
    const { onSubmit, input } = field();

    fireEvent.change(input, { target: { value: 'Портфель' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
