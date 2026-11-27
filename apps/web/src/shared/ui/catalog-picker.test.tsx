// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { CatalogPicker } from './catalog-picker.js';

const GROUPS = [
  {
    id: 'task',
    label: 'Задачи',
    items: [
      { id: 't1', name: 'Комплект', icon: <i data-testid="tile" /> },
      { id: 't2', name: 'Задание смежнику', icon: <i data-testid="tile" /> },
    ],
  },
  {
    id: 'letter',
    label: 'Письма',
    items: [{ id: 'l1', name: 'Входящее', icon: <i data-testid="tile" />, badge: 'Письмо' }],
  },
];

function view(open = true, groups = GROUPS, onConnect = vi.fn(), onClose = vi.fn()) {
  render(
    <CatalogPicker
      title="Подключить тип задачи"
      groups={groups}
      open={open}
      onClose={onClose}
      onConnect={onConnect}
    />,
  );
  return { onConnect, onClose };
}

afterEach(cleanup);

describe('CatalogPicker — окно подключения из справочника (#857, волна 9)', () => {
  it('окно по центру: заголовок, поиск, строки групп с плитками и чекбоксами', () => {
    view();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Подключить тип задачи')).toBeTruthy();
    // Две группы — подписи видны; строки несут плитку-значок и чекбокс.
    expect(within(dialog).getByText('Задачи')).toBeTruthy();
    expect(within(dialog).getByText('Письма')).toBeTruthy();
    expect(within(dialog).getAllByTestId('tile').length).toBe(3);
    expect(within(dialog).getAllByRole('checkbox').length).toBe(3);
  });

  it('«Подключить» недоступна без выбора; чекбокс строки и заголовка выбирают', () => {
    view();
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: ui.automation.entry.connectAction });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Комплект' }));
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('мультивыбор: отмеченные уходят одним списком, окно закрывается', () => {
    const { onConnect, onClose } = view();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Комплект' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Задание смежнику' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: ui.automation.entry.connectAction }),
    );
    expect(onConnect).toHaveBeenCalledWith(['t1', 't2']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('поиск фильтрует по имени по всем группам; пустой — честная заглушка', () => {
    view();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(ui.common.search), {
      target: { value: 'вход' },
    });
    expect(within(dialog).getByText('Входящее')).toBeTruthy();
    expect(within(dialog).queryByText('Комплект')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(ui.common.search), {
      target: { value: 'нет такого' },
    });
    expect(within(dialog).getByText(ui.automation.entry.searchEmpty)).toBeTruthy();
  });

  it('единственная группа — без заголовка; всё подключено — заглушка справочника', () => {
    view(true, [{ id: 'task', label: 'Задачи', items: [] }]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Задачи')).toBeNull();
    expect(within(dialog).getByText(ui.automation.entry.pickerNothingLeft)).toBeTruthy();
  });

  it('закрытое окно не рисуется; повторное открытие начинает с чистого выбора', () => {
    const { onConnect } = view(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
    cleanup();
    view(true);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Комплект' }));
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));
    cleanup();
    const second = view(true);
    const again = screen.getByRole('dialog');
    const submit = within(again).getByRole('button', {
      name: ui.automation.entry.connectAction,
    });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(second.onConnect).not.toHaveBeenCalled();
  });
});
