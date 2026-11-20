// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { ReferenceCombobox, type ReferenceOption } from './reference-combobox.js';

/** Общий выбор из справочника (#981): список под полем, поиск, «Не выбрано»,
 *  крестик сброса, Esc закрывает список, а не окно. */

const OPTIONS: ReferenceOption[] = [
  { id: 'dep-1', label: 'BIM-отдел', secondary: 'Иванов Иван' },
  { id: 'dep-2', label: 'Административное', secondary: 'Петров Пётр' },
];

function Harness({
  initial = null,
  allowClear = true,
  onChange,
}: {
  initial?: string | null;
  allowClear?: boolean;
  onChange?: (id: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div onKeyDown={() => undefined}>
      <ReferenceCombobox
        value={value}
        onChange={(id) => {
          onChange?.(id);
          setValue(id);
        }}
        options={OPTIONS}
        ariaLabel="Подразделение"
        placeholder="Начните вводить название"
        allowClear={allowClear}
      />
      <span data-testid="value">{value ?? 'null'}</span>
    </div>
  );
}

afterEach(cleanup);

describe('ReferenceCombobox (#981)', () => {
  it('выбранное значение видно в поле; ввод фильтрует; выбор пишет id', () => {
    const onChange = vi.fn();
    render(<Harness initial="dep-1" onChange={onChange} />);
    const field = screen.getByRole('combobox', { name: 'Подразделение' }) as HTMLInputElement;
    expect(field.value).toBe('BIM-отдел');

    fireEvent.click(field);
    fireEvent.change(field, { target: { value: 'админ' } });
    expect(screen.queryByRole('option', { name: /BIM-отдел/ })).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /Административное/ }));
    expect(onChange).toHaveBeenCalledWith('dep-2');
    expect(screen.getByTestId('value').textContent).toBe('dep-2');
  });

  it('«Не выбрано» и крестик сбрасывают выбор', () => {
    const onChange = vi.fn();
    render(<Harness initial="dep-1" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: ui.employees.clearSelection }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('combobox', { name: 'Подразделение' }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(ui.employees.notSelected) }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('value').textContent).toBe('null');
  });

  it('обязательный выбор: ни «Не выбрано», ни крестика', () => {
    render(<Harness initial="dep-1" allowClear={false} />);

    expect(screen.queryByRole('button', { name: ui.employees.clearSelection })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Подразделение' }));
    expect(screen.queryByRole('option', { name: new RegExp(ui.employees.notSelected) })).toBeNull();
  });

  it('пустой поиск — «Ничего не найдено»', () => {
    render(<Harness />);
    const field = screen.getByRole('combobox', { name: 'Подразделение' });

    fireEvent.click(field);
    fireEvent.change(field, { target: { value: 'нет такого' } });

    expect(screen.getByText(ui.filters.notFound)).toBeTruthy();
  });

  it('Esc закрывает список, а не окно вокруг', () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <Harness />
      </div>,
    );
    const field = screen.getByRole('combobox', { name: 'Подразделение' });

    fireEvent.click(field);
    expect(screen.getByRole('option', { name: /BIM-отдел/ })).toBeTruthy();

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: /BIM-отдел/ })).toBeNull();
    // stopPropagation: Esc не дошёл до окна-родителя (иначе диалог закрылся бы).
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
