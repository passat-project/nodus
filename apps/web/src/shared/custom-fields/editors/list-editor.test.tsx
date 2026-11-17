// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ListEditor } from './list-editor.js';

/** Поиск в поповере-списке (#843): программное закрытие после выбора не идёт
 *  через onOpenChange — фильтр не должен переезжать в следующее открытие. */

const ITEMS = [
  { id: 'a', name: 'Первый', isActive: true, color: null },
  { id: 'b', name: 'Второй', isActive: true, color: null },
  { id: 'c', name: 'Третий', isActive: true, color: null },
  { id: 'd', name: 'Четвёртый', isActive: true, color: null },
  { id: 'e', name: 'Пятый', isActive: true, color: null },
  { id: 'f', name: 'Шестой', isActive: true, color: null },
];

vi.mock('../../dictionaries/queries.js', () => ({
  useDictionaryItems: () => ({ data: ITEMS }),
}));

const DEFINITION = {
  id: 'field-1',
  name: 'Статус',
  type: 'enum',
  dictionary: { code: 'status' },
} as unknown as CustomFieldDefinition;

afterEach(cleanup);

describe('ListEditor: сброс поиска при выборе (#843)', () => {
  it('после выбора варианта следующий показ начинается с полного списка', () => {
    render(
      <ListEditor
        definition={DEFINITION}
        value={undefined}
        refs={[]}
        disabled={false}
        variant="inline"
        onCommit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Статус' }));
    const search = screen.getByLabelText(ui.common.search);
    fireEvent.change(search, { target: { value: 'Втор' } });
    expect(screen.queryByText('Первый')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Второй' }));
    fireEvent.click(screen.getByRole('button', { name: 'Статус' }));

    expect((screen.getByLabelText(ui.common.search) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Первый')).toBeTruthy();
  });
});
