// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PeoplePicker } from './people-picker.js';

vi.mock('../api/users-list.js', () => ({
  useUsersSearch: () => ({
    data: {
      items: [
        { id: 'u1', displayName: 'Иванов Иван', positionName: null, avatarUrl: null },
        { id: 'u2', displayName: 'Петров Пётр', positionName: null, avatarUrl: null },
      ],
    },
    isFetching: false,
  }),
}));

describe('PeoplePicker: поиск при повторном открытии', () => {
  it('сбрасывается после выбора в одиночном режиме', () => {
    render(
      <PeoplePicker selectedIds={[]} onToggle={() => vi.fn()} ariaLabel="Исполнитель">
        <button type="button">Открыть</button>
      </PeoplePicker>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Исполнитель' }));
    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'Ив' } });
    expect((search as HTMLInputElement).value).toBe('Ив');

    fireEvent.click(screen.getByRole('button', { name: /Иванов Иван/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Исполнитель' }));

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
});
