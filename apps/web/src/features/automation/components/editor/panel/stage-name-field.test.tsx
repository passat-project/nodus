// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
});
