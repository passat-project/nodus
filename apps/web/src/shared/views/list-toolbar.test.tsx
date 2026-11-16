// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { FilterFieldDef } from './list-filters.js';
import { ListToolbar } from './list-toolbar.js';
import { useListToolbar } from './use-list-toolbar.js';

/** Строка инструментов списка: чипы активных фильтров внутри поиска.
 *  `hiddenChips` — поле, чьё значение показывает свой контрол (журнал
 *  «Проекты»: имя папки носит кнопка «Портфели», 13.11.2026): фильтр остаётся
 *  в состоянии и в панели, но чипа в строке нет. */
interface Row {
  name: string;
}

const PORTFOLIO: FilterFieldDef<Row> = {
  id: 'portfolio',
  label: 'Портфели',
  type: 'select',
  options: [{ value: 'p-1', label: 'Нежин-Недра' }],
  match: () => true,
};

const STATUS: FilterFieldDef<Row> = {
  id: 'status',
  label: 'Статус',
  type: 'select',
  options: [{ value: 'active', label: 'Активен' }],
  match: () => true,
};

function Harness({ hiddenChips }: { hiddenChips?: readonly string[] }) {
  const toolbar = useListToolbar('test.toolbar');
  return (
    <>
      <button type="button" onClick={() => toolbar.setFilter('portfolio', 'p-1')}>
        выбрать портфель
      </button>
      <button type="button" onClick={() => toolbar.setFilter('status', 'active')}>
        выбрать статус
      </button>
      <ListToolbar toolbar={toolbar} defs={[PORTFOLIO, STATUS]} hiddenChips={hiddenChips} />
    </>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ListToolbar: чипы активных фильтров (#559)', () => {
  it('обычный фильтр показывается чипом в строке поиска', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'выбрать статус' }));

    expect(screen.getByText('Статус: Активен')).toBeTruthy();
  });

  it('скрытый чип: значение фильтра живёт в состоянии, но чипа нет', () => {
    render(<Harness hiddenChips={['portfolio']} />);

    fireEvent.click(screen.getByRole('button', { name: 'выбрать портфель' }));

    expect(screen.queryByText('Портфели: Нежин-Недра')).toBeNull();
    // Другой фильтр по-прежнему читается чипом — скрыт ровно указанный.
    fireEvent.click(screen.getByRole('button', { name: 'выбрать статус' }));
    expect(screen.getByText('Статус: Активен')).toBeTruthy();
  });
});
