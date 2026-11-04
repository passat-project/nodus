// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { StageNameField } from './stage-name-field.js';

afterEach(cleanup);

describe('StageNameField: мягкие подсказки имён (#430)', () => {
  it('показывает имена того же этапа и подставляет выбранное', () => {
    const onChange = vi.fn();
    render(
      <StageNameField
        value="В раб"
        systemState="active"
        suggestions={[
          { systemState: 'active', name: 'В работе', routes: 4 },
          { systemState: 'closed', name: 'Завершена', routes: 2 },
        ]}
        loading={false}
        readOnly={false}
        autoFocus={false}
        onChange={onChange}
      />,
    );

    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('4 маршрута')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /В работе/ }));
    expect(onChange).toHaveBeenLastCalledWith('В работе');
  });

  it('фильтрует по введённому тексту', () => {
    render(
      <StageNameField
        value=""
        systemState="active"
        suggestions={[{ systemState: 'active', name: 'В работе', routes: 4 }]}
        loading={false}
        readOnly={false}
        autoFocus={false}
        onChange={() => undefined}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'заверш' } });
    expect(screen.queryByRole('option', { name: /В работе/ })).toBeNull();
    expect(screen.getByText('В этом этапе пока нет других имён')).toBeTruthy();
  });

  it('клавиатура: стрелка и Enter выбирают подсказку', () => {
    const onChange = vi.fn();
    render(
      <StageNameField
        value=""
        systemState="active"
        suggestions={[
          { systemState: 'active', name: 'В работе', routes: 4 },
          { systemState: 'active', name: 'На проверке', routes: 2 },
        ]}
        loading={false}
        readOnly={false}
        autoFocus={false}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('На проверке');
  });

  it('loading показывает «Загружаем имена…»', () => {
    render(
      <StageNameField
        value=""
        systemState="active"
        suggestions={[]}
        loading
        readOnly={false}
        autoFocus={false}
        onChange={() => undefined}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText(ui.automation.stageNameSuggestLoading)).toBeTruthy();
  });

  it('явный пункт «Создать новое имя» закрывает подсказки', () => {
    render(
      <StageNameField
        value="Своё имя"
        systemState="active"
        suggestions={[{ systemState: 'active', name: 'В работе', routes: 4 }]}
        loading={false}
        readOnly={false}
        autoFocus={false}
        onChange={() => undefined}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.stageNameSuggestCreate }));
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});
