// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { SettingsCompactDialog } from './settings-compact-dialog.js';

/** Идёт ли `a` в документе раньше `b` (jsdom не раскладывает — порядок = DOM). */
const precedes = (a: Element, b: Element): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(cleanup);

describe('SettingsCompactDialog — компактное окно настроек без навигации', () => {
  it('содержимое одной колонкой, без вкладок; футер: опасное действие слева, «Закрыть» справа', () => {
    render(
      <SettingsCompactDialog
        title="Настройки типа папки · Комплект"
        onClose={vi.fn()}
        danger={<button type="button">В архив</button>}
      >
        <p>Содержимое</p>
      </SettingsCompactDialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    expect(within(dialog).getByText('Содержимое')).toBeTruthy();
    expect(
      precedes(within(dialog).getByText('В архив'), within(dialog).getByText(ui.common.close)),
    ).toBe(true);
  });

  it('без опасного действия в футере только «Закрыть»; мимо-клик окно не закрывает', () => {
    const onClose = vi.fn();
    render(
      <SettingsCompactDialog title="Настройки типа папки" onClose={onClose}>
        <p>Содержимое</p>
      </SettingsCompactDialog>,
    );
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([ui.common.close]);
    fireEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
