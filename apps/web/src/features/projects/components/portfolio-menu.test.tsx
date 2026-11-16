// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { ProjectGroup, ProjectPortfolioCount } from '@nodus/contracts';

import { buildPortfolioFolders } from '../lib/portfolio-folders.js';
import { PortfolioMenu } from './portfolio-menu.js';

/** Вкладка «Портфели» журнала «Проекты» (#559): список папок в поповере
 *  сразу после поиска — счётчики, статусы папки, архив, управление, DnD. */
const METRO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  archivedAt: null,
};
const OLD: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000003',
  name: 'Старый объект',
  archivedAt: '2026-11-01T10:00:00.000Z',
};
const EMPTY_ARCHIVED: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000004',
  name: 'Пустой архив',
  archivedAt: '2026-11-02T10:00:00.000Z',
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
    draggingProjectId: null,
    onCreate: noop(),
    onSelect: noop(),
    onRename: noop(),
    onArchive: noop(),
    onRestore: noop(),
    onDelete: noop(),
    onDropProject: noop(),
    ...overrides,
  };
  render(<PortfolioMenu {...props} />);
  return props;
}

/** Открыть поповер вкладки «Портфели». */
function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Портфели' }));
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

describe('PortfolioMenu — вкладка «Портфели» (#559)', () => {
  it('список скрыт, пока вкладку не открыли', () => {
    renderMenu();

    expect(screen.queryByText('Нежин-Недра')).toBeNull();
    openMenu();
    expect(screen.getByText('Нежин-Недра')).toBeTruthy();
  });

  it('показывает «Все проекты», портфели «действует / всего» и «Без портфеля»', () => {
    renderMenu();
    openMenu();

    expect(screen.getByText('Все проекты')).toBeTruthy();
    expect(screen.getByText('109')).toBeTruthy();
    expect(screen.getByText('98 / 100')).toBeTruthy();
    expect(screen.getByText('Без портфеля')).toBeTruthy();
    expect(screen.getByText('4 / 7')).toBeTruthy();
  });

  it('архивные папки — отдельной группой «Архив»', () => {
    renderMenu();
    openMenu();

    expect(screen.getByText('Архив')).toBeTruthy();
    expect(screen.getByText('Старый объект')).toBeTruthy();
  });

  it('без портфелей — «Все проекты», подсказка и создание', () => {
    renderMenu({ tree: buildPortfolioFolders([], []) });
    openMenu();

    expect(screen.getByText('Все проекты')).toBeTruthy();
    expect(screen.getByText('Портфелей пока нет')).toBeTruthy();
    expect(screen.queryByText('Без портфеля')).toBeNull();
    expect(screen.queryByText('Архив')).toBeNull();
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

  it('перетаскивание проекта открывает список само — папка цель броска', () => {
    const props = renderMenu({ draggingProjectId: 'project-1' });

    // Поповер открыт без клика: цель броска должна быть видна.
    expect(screen.getByText('Нежин-Недра')).toBeTruthy();

    const row = folder('Нежин-Недра');
    fireEvent.dragOver(row, { dataTransfer: { dropEffect: '' } });
    fireEvent.drop(row, { dataTransfer: { dropEffect: '' } });
    expect(props.onDropProject).toHaveBeenCalledWith(METRO.id);
  });

  it('«Без портфеля» принимает бросок, «Все проекты» и архив — нет', () => {
    const props = renderMenu({ draggingProjectId: 'project-1' });

    fireEvent.drop(folder('Без портфеля'));
    expect(props.onDropProject).toHaveBeenCalledWith('none');

    fireEvent.drop(folder('Все проекты'));
    fireEvent.drop(folder('Старый объект'));
    expect(props.onDropProject).toHaveBeenCalledOnce();
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

  it('настройка прямо в строке папки: переименование и архив', async () => {
    const props = renderMenu();
    openMenu();

    openFolderMenu(METRO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }));
    expect(props.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: METRO.id }));

    openMenu();
    openFolderMenu(METRO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Архивировать портфель' }));
    expect(props.onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: METRO.id }));
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it('у архивной папки в строке — «Вернуть портфель»', async () => {
    const props = renderMenu();
    openMenu();

    openFolderMenu(OLD.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Вернуть портфель' }));
    expect(props.onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: OLD.id }));
    expect(props.onArchive).not.toHaveBeenCalled();
  });

  it('архивная папка без проектов видна в «Архиве» и возвращается из него', () => {
    renderMenu({ tree: buildPortfolioFolders([METRO, EMPTY_ARCHIVED], COUNTS) });
    openMenu();

    const row = folder('Пустой архив');
    expect(within(row).getByText('0 / 0')).toBeTruthy();
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
      archivedAt: null,
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
