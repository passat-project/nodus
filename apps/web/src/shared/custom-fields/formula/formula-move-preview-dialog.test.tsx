// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormulaMovePreviewEntry } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { FormulaMovePreviewDialog, movePreviewValueText } from './formula-move-preview-dialog.js';

/** Строка диффа: запись-хост, атрибут и «было → станет» (#632, критерий 1). */
function entry(
  index: number,
  extra: Partial<FormulaMovePreviewEntry> = {},
): FormulaMovePreviewEntry {
  const tail = String(index).padStart(12, '0');
  return {
    hostKind: 'task',
    hostId: `21000000-0000-4000-8000-${tail}`,
    fieldId: `35560000-0000-4000-8000-${tail}`,
    hostLabel: `#${index} Комплект`,
    fieldName: 'Шифр',
    from: 'А-1',
    to: 'Б-2',
    ...extra,
  };
}

describe('FormulaMovePreviewDialog: подтверждение переноса с диффом формул (#632)', () => {
  afterEach(cleanup);

  it('пустой дифф окна не открывает, непустой — карточка «атрибут · запись», было/станет', () => {
    const { container } = render(
      <FormulaMovePreviewDialog changes={[]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();

    render(
      <FormulaMovePreviewDialog changes={[entry(1)]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(ui.formulas.move.title)).toBeTruthy();
    expect(screen.getByText(ui.formulas.move.hint)).toBeTruthy();
    // Две строки карточки: атрибут-плашка + запись, ниже «Было»/«Станет».
    expect(screen.getByText('Шифр')).toBeTruthy();
    expect(screen.getByText('#1 Комплект')).toBeTruthy();
    expect(screen.getByText(ui.formulas.move.before)).toBeTruthy();
    expect(screen.getByText(ui.formulas.move.after)).toBeTruthy();
    expect(screen.getByText('А-1')).toBeTruthy();
    expect(screen.getByText('Б-2')).toBeTruthy();
  });

  it('длинные значения не обрезаются одной строкой: у них break-words, а не truncate', () => {
    render(
      <FormulaMovePreviewDialog
        changes={[
          entry(1, { from: '0359-1-КЖ1-ОЧЕНЬ-ДЛИННЫЙ-ШИФР', to: '0359-2-КЖ1-ОЧЕНЬ-ДЛИННЫЙ-ШИФР' }),
        ]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const from = screen.getByText('0359-1-КЖ1-ОЧЕНЬ-ДЛИННЫЙ-ШИФР');
    expect(from.className).toContain('break-words');
    expect(from.className).not.toContain('truncate');
  });

  it('обрезанная выборка — предупреждение, что изменения не все', () => {
    render(
      <FormulaMovePreviewDialog
        changes={[entry(1)]}
        truncated
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(ui.formulas.move.truncated)).toBeTruthy();
  });

  it('больше 10 строк — первые 10 и «и ещё N»', () => {
    const changes = Array.from({ length: 13 }, (_, index) => entry(index + 1));
    render(<FormulaMovePreviewDialog changes={changes} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText(`${ui.formulas.move.more} 3`)).toBeTruthy();
  });

  it('ровно 10 строк — без хвоста «и ещё»', () => {
    const changes = Array.from({ length: 10 }, (_, index) => entry(index + 1));
    render(<FormulaMovePreviewDialog changes={changes} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByText(new RegExp(ui.formulas.move.more))).toBeNull();
  });

  it('кнопки: «Перенести» подтверждает, «Отмена» отменяет', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <FormulaMovePreviewDialog changes={[entry(1)]} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.formulas.move.confirm }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: ui.formulas.move.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('значение текстом без определения атрибута: пусто, да/нет, список, деньги', () => {
    expect(movePreviewValueText(null)).toBe(ui.customFields.value.empty);
    expect(movePreviewValueText('   ')).toBe(ui.customFields.value.empty);
    expect(movePreviewValueText(true)).toBe(ui.customFields.value.yes);
    expect(movePreviewValueText(false)).toBe(ui.customFields.value.no);
    expect(movePreviewValueText(['a', 'b'])).toBe('a, b');
    expect(movePreviewValueText([])).toBe(ui.customFields.value.empty);
    expect(movePreviewValueText(12)).toBe('12');
    expect(movePreviewValueText({ amount: 1234.5, currencyId: 'currency' })).toMatch(/1.234,50/);
  });
});
