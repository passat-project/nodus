import { fireEvent, screen, within } from '@testing-library/react';
import { ui } from '@nodus/contracts';

/** Строка журнала (`DataTable`, role=row) по тексту в одной из её ячеек. */
export function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="row"]') as HTMLElement;
}

/** Открыть «⋯» строки журнала и вернуть меню (Radix DropdownMenu открывается
 *  pointerdown + click). Пункт меню: `within(menu).getByRole('menuitem')`. */
export async function openRowMenu(name: string): Promise<HTMLElement> {
  const menu = within(rowOf(name)).getByRole('button', { name: ui.common.rowMenu });
  fireEvent.pointerDown(menu, { button: 0, pointerType: 'mouse' });
  fireEvent.click(menu);
  return (await screen.findByRole('menu')) as HTMLElement;
}

/** Прямоугольник строки (в jsdom `getBoundingClientRect` даёт нули): подменяет
 *  его у строки и возвращает — источник раскрытия карточки поверх. */
export const ROW_RECT = {
  x: 300,
  y: 140,
  top: 140,
  left: 300,
  right: 700,
  bottom: 188,
  width: 400,
  height: 48,
};

export function withRowRect(row: HTMLElement): typeof ROW_RECT {
  row.getBoundingClientRect = () => ROW_RECT as DOMRect;
  return ROW_RECT;
}
