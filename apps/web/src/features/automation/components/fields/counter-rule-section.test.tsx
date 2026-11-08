// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormulaNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { DEFAULT_COUNTER_RULE } from '../../lib/counter-rule.js';
import { CounterRuleSection } from './counter-rule-section.js';

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));

vi.mock('../../../../shared/custom-fields/formula/type-formula-dialog.js', () => ({
  TypeFormulaDialog: ({ onSave }: { onSave: (ast: FormulaNode | null) => void }) => (
    <button
      type="button"
      aria-label="Применить формулу разреза"
      onClick={() => onSave({ kind: 'literal', value: 'папка-1' })}
    />
  ),
}));

const counter = ui.customFields.dialog.counter;

function renderSection(
  rule = DEFAULT_COUNTER_RULE,
  onChange = vi.fn<(rule: typeof DEFAULT_COUNTER_RULE) => void>(),
) {
  render(
    <CounterRuleSection rule={rule} disabled={false} issuedCount={null} onChange={onChange} />,
  );
  return onChange;
}

afterEach(cleanup);

describe('единый конструктор правила счётчика (#630)', () => {
  it('в основном окне — сводка; вид номера правится в конструкторе', () => {
    const onChange = renderSection();

    expect(screen.queryByRole('button', { name: `+ ${counter.segYear2}` })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: counter.edit }));
    expect(screen.getByText(counter.dialogTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `+ ${counter.segYear2}` }));
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.dialog.save }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_COUNTER_RULE,
      template: [{ kind: 'counter' }, { kind: 'year', digits: 2 }],
    });
    expect(screen.queryByText(counter.dialogTitle)).toBeNull();
  });

  it('текстовый сегмент удаляется своим крестиком, как остальные сегменты', () => {
    const onChange = renderSection();

    fireEvent.click(screen.getByRole('button', { name: counter.edit }));
    fireEvent.click(screen.getByRole('button', { name: `+ ${counter.literalPlaceholder}` }));
    const input = screen.getByRole('textbox', { name: counter.literalPlaceholder });
    fireEvent.change(input, { target: { value: 'лорлорлор' } });
    expect((input as HTMLInputElement).value).toBe('лорлорлор');

    const removeButtons = screen.getAllByRole('button', { name: counter.segRemove });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]!);

    expect(screen.queryByRole('textbox', { name: counter.literalPlaceholder })).toBeNull();
    expect(screen.getAllByRole('button', { name: counter.segRemove })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.dialog.save }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_COUNTER_RULE);
  });

  it('своя формула разреза открывает формульный редактор и возвращается в правило', () => {
    const onChange = renderSection({
      ...DEFAULT_COUNTER_RULE,
      scopeKind: 'formula',
    });

    fireEvent.click(screen.getByRole('button', { name: counter.edit }));
    const save = screen.getByRole('button', { name: ui.customFields.dialog.save });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Заполните формулу разреза/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить формулу разреза' }));

    expect(screen.getByText(counter.dialogTitle)).toBeTruthy();
    const saveReady = screen.getByRole('button', { name: ui.customFields.dialog.save });
    expect((saveReady as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveReady);
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_COUNTER_RULE,
      scopeKind: 'formula',
      scopeFormula: { kind: 'literal', value: 'папка-1' },
    });
  });
});
