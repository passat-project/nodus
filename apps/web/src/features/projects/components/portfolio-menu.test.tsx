// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { ProjectGroup, ProjectPortfolioCount } from '@nodus/contracts';

import { buildPortfolioFolders } from '../lib/portfolio-folders.js';
import { PortfolioMenu } from './portfolio-menu.js';

/** Кнопка «Портфели» журнала «Проекты» (#559): список папок в поповере сразу
 *  после «Создать» — выбор фильтра и настройка папок. Архива у папки нет
 *  (13.11.2026), имя выбранной папки носит сама кнопка; бросок строки проекта
 *  сюда убран (#1014). */
const METRO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
};
const OLD: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000003',
  name: 'Старый объект',
};
const COUNTS: ProjectPortfolioCount[] = [
  { portfolioId: METRO.id, active: 98, completed: 2, archived: 0 },
  { portfolioId: OLD.id, active: 0, completed: 2, archived: 0 },
  { portfolioId: null, active: 4, completed: 1, archived: 2 },
];

const tree = buildPortfolioFolders([METRO, OLD], COUNTS);

function noop() {
  return vi.fn();
}

function renderMenu(overrides: Partial<ComponentProps<typeof PortfolioMenu>> = {}) {
  const props: ComponentProps<typeof PortfolioMenu> = {
    tree,
    selection: 'all',
    canCreate: true,
    canManage: true,
    onCreate: noop(),
    onSelect: noop(),
    onRename: noop(),
    onDelete: noop(),
    ...overrides,
  };
  render(<PortfolioMenu {...props} />);
  return props;
}

/** Кнопка-триггер «Портфели» (её подпись зависит от выбранной папки). */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Портфели/ });
}

/** Открыть поповер списка папок. */
function openMenu() {
  fireEvent.click(trigger());
}

/** Строка папки в поповере по её подписи (контейнер с кнопкой и «⋯»). */
function folder(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-folder-row]') as HTMLElement;
}

/** Меню настройки папки: Radix открывается pointerdown, затем click. */
function openFolderMenu(name: string) {
  const button = within(folder(name)).getByRole('button', { name: 'Действия строки' });
  fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
  fireEvent.click(button);
}

afterEach(cleanup);

describe('PortfolioMenu — кнопка «Портфели» (#559)', () => {
  it('список скрыт, пока кнопку не нажали', () => {
    renderMenu();

    expect(screen.queryByText('Нежин-Недра')).toBeNull();
    openMenu();
    expect(screen.getByText('Нежин-Недра')).toBeTruthy();
  });

  it('без выбора кнопка называется «Портфели»', () => {
    renderMenu();

    expect(trigger().textContent).toContain('Портфели');
  });

  it('выбранная папка называет кнопку — имя портфеля, а не «Портфели»', () => {
    renderMenu({ selection: METRO.id });

    expect(trigger().textContent).toContain(METRO.name);
    expect(trigger().getAttribute('title')).toBe(METRO.name);
  });

  it('«Без портфеля» тоже называет кнопку', () => {
    renderMenu({ selection: 'none' });

    expect(trigger().textContent).toContain('Без портфеля');
  });

  it('вид кнопки не зависит от выбора: нейтральный, без подсветки', () => {
    renderMenu({ selection: METRO.id });

    expect(trigger().className.split(/\s+/)).not.toContain('bg-accent');
    expect(trigger().className).toContain('border-input');
  });

  it('показывает «Все проекты», портфели и «Без портфеля» — без счётчиков', () => {
    renderMenu();
    openMenu();

    expect(screen.getByText('Все проекты')).toBeTruthy();
    expect(screen.getByText('Нежин-Недра')).toBeTruthy();
    expect(screen.getByText('Без портфеля')).toBeTruthy();
    // Счётчики «2 / 2» из поповера убраны (решение 16.11.2026).
    expect(screen.queryByText('98 / 100')).toBeNull();
    expect(screen.queryByText('4 / 7')).toBeNull();
    expect(screen.queryByText('109')).toBeNull();
  });

  it('группы «Архив» больше нет: все папки в одном списке', () => {
    renderMenu();
    openMenu();

    expect(screen.queryByText('Архив')).toBeNull();
    expect(screen.getByText('Старый объект')).toBeTruthy();
  });

  it('без портфелей — «Все проекты», подсказка и создание', () => {
    renderMenu({ tree: buildPortfolioFolders([], []) });
    openMenu();

    expect(screen.getByText('Все проекты')).toBeTruthy();
    expect(screen.getByText('Портфелей пока нет')).toBeTruthy();
    expect(screen.queryByText('Без портфеля')).toBeNull();
    expect(screen.getByRole('button', { name: 'Новый портфель' })).toBeTruthy();
  });

  it('клик по портфелю выбирает папку и закрывает список', () => {
    const props = renderMenu();
    openMenu();

    fireEvent.click(screen.getByText('Нежин-Недра'));
    expect(props.onSelect).toHaveBeenCalledWith(METRO.id);
    expect(screen.queryByText('Нежин-Недра')).toBeNull();
  });

  it('«Без портфеля» — выбор папки none', () => {
    const props = renderMenu();
    openMenu();

    fireEvent.click(screen.getByText('Без портфеля'));
    expect(props.onSelect).toHaveBeenCalledWith('none');
  });

  it('перетаскивание не открывает список само — он только для клика (#1014)', () => {
    renderMenu();

    fireEvent.dragStart(document.body);
    fireEvent.dragEnd(document.body);

    expect(screen.queryByText('Нежин-Недра')).toBeNull();
  });

  it('создание портфеля инлайн: пункт → поле → Enter создаёт и закрывает', () => {
    const props = renderMenu();
    openMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Новый портфель' }));
    const input = screen.getByPlaceholderText('Например: Метро, линия 4');
    fireEvent.change(input, { target: { value: 'Нежин-Недра 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onCreate).toHaveBeenCalledWith('Нежин-Недра 2');
    expect(screen.queryByPlaceholderText('Например: Метро, линия 4')).toBeNull();
  });

  it('отмена инлайн-создания: Esc убирает поле и не создаёт папку', () => {
    const props = renderMenu();
    openMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Новый портфель' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Например: Метро, линия 4'), { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Например: Метро, линия 4')).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('без project.create нет создания; без project.manage нет настройки папки', () => {
    renderMenu({ canCreate: false, canManage: false, selection: METRO.id });
    openMenu();

    expect(screen.queryByRole('button', { name: 'Новый портфель' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Действия строки' })).toBeNull();
  });

  it('у «Все проекты» и «Без портфеля» нет настройки, у портфеля — есть', () => {
    renderMenu();
    openMenu();

    expect(
      within(folder('Все проекты')).queryByRole('button', { name: 'Действия строки' }),
    ).toBeNull();
    expect(
      within(folder('Без портфеля')).queryByRole('button', { name: 'Действия строки' }),
    ).toBeNull();
    expect(
      within(folder(METRO.name)).getByRole('button', { name: 'Действия строки' }),
    ).toBeTruthy();
  });

  it('настройка в строке папки: переименование и удаление, архива нет', async () => {
    const props = renderMenu();
    openMenu();

    openFolderMenu(METRO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }));
    expect(props.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: METRO.id }));

    openMenu();
    openFolderMenu(METRO.name);
    await screen.findByRole('menuitem', { name: 'Удалить портфель' });
    expect(screen.queryByRole('menuitem', { name: 'Архивировать портфель' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Вернуть портфель' })).toBeNull();
  });

  it('в режиме «Мои» пункт называется «Мои проекты»', () => {
    renderMenu({ allLabel: 'Мои проекты' });
    openMenu();

    expect(screen.getByText('Мои проекты')).toBeTruthy();
    expect(screen.queryByText('Все проекты')).toBeNull();
  });

  it('длинное имя папки целиком лежит в title строки', () => {
    const long: ProjectGroup = {
      id: '42000000-0000-4000-8000-000000000009',
      name: 'Очень длинный портфель большого объекта с десятками договоров',
    };
    renderMenu({ tree: buildPortfolioFolders([long], []) });
    openMenu();

    expect(folder(long.name).querySelector('button')?.getAttribute('title')).toBe(long.name);
  });

  it('удаление портфеля — пункт «Удалить портфель» в меню строки', async () => {
    const props = renderMenu();
    openMenu();

    openFolderMenu(METRO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить портфель' }));

    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: METRO.id }));
  });
});
