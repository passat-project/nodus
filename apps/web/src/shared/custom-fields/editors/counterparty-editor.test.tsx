// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../../counterparties/queries.js', () => ({
  useCounterpartyOptions: () => ({
    data: [
      { id: 'c-1', shortName: 'ООО «Ромашка»', unp: '100000001', archivedAt: null },
      { id: 'c-2', shortName: 'ООО «Василёк»', unp: '100000002', archivedAt: null },
    ],
  }),
}));

import { CounterpartyEditor } from './counterparty-editor.js';

const definition = {
  id: 'f-counterparty',
  type: 'counterparty',
  name: 'Контрагент',
} as CustomFieldDefinition;

afterEach(cleanup);

/** Пикер контрагента (#843): программное закрытие после выбора не идёт через
 *  onOpenChange — строка поиска не должна оставаться в следующем открытии. */
describe('CounterpartyEditor: сброс поиска при выборе', () => {
  it('после выбора контрагента следующий показ начинается с полного списка', () => {
    render(
      <CounterpartyEditor
        definition={definition}
        value={undefined}
        refs={[]}
        disabled={false}
        variant="inline"
        onCommit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Контрагент' }));
    fireEvent.change(screen.getByLabelText(ui.common.search), {
      target: { value: 'Ромашка' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ромашка/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Контрагент' }));

    expect((screen.getByLabelText(ui.common.search) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('ООО «Василёк»')).toBeTruthy();
  });
});
