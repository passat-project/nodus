// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { UserRef } from '@nodus/contracts';

import { AddresseeField } from './addressee-field.js';

afterEach(cleanup);

const RESOLVER: UserRef = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Иванов Иван',
  avatarUrl: null,
};
const CURRENT: UserRef = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Петров Пётр',
  avatarUrl: null,
};

vi.mock('../../../../shared/api/users-list.js', () => ({
  useUsersSearch: () => ({
    data: {
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          displayName: 'Сидоров Сидор',
          positionName: null,
          avatarUrl: null,
        },
      ],
    },
  }),
}));
vi.mock('../../api/letters-queries.js', () => ({
  useLetterResolvers: () => ({ data: [RESOLVER] }),
}));

describe('AddresseeField: Enter и открытость списка', () => {
  it('при закрытом списке Enter не подменяет выбранного адресата первым из справочника', () => {
    const onChange = vi.fn();
    render(<AddresseeField value={CURRENT} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('в открытом списке Enter выбирает подсвеченного (первого) адресата', () => {
    const onChange = vi.fn();
    render(<AddresseeField value={CURRENT} onChange={onChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: RESOLVER.id }));
  });
});
