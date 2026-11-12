// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { ProjectGroup, ProjectPortfolioCount } from '@nodus/contracts';

import { buildPortfolioFolders } from '../lib/portfolio-folders.js';
import { PortfolioRail } from './portfolio-rail.js';

/** Левая колонка журнала «Проекты» (#559): папки-портфели со счётчиками,
 *  «Без портфеля», строки статусов внутри папки, создание и перетаскивание. */
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

function renderRail(overrides: Partial<ComponentProps<typeof PortfolioRail>> = {}) {
  const props: ComponentProps<typeof PortfolioRail> = {
    tree,
    selection: 'all',
    status: 'all',
    canCreate: true,
    canManage: true,
    draggingProjectId: null,
    onCreate: noop(),
    onSelect: noop(),
    onStatus: noop(),
    onRename: noop(),
    onArchive: noop(),
    onRestore: noop(),
    onDropProject: noop(),
    ...overrides,
  };
  render(<PortfolioRail {...props} />);
  return props;
}

afterEach(cleanup);

describe('PortfolioRail — папки и счётчики (#559)', () => {
  it('показывает «Все проекты», портфели «действует / всего» и «Без портфеля»', () => {
    renderRail();

    expect(screen.getByText('Все проекты')).toBeTruthy();
    expect(screen.getByText('109')).toBeTruthy();
    expect(screen.getByText('Нежин-Недра')).toBeTruthy();
    expect(screen.getByText('98 / 100')).toBeTruthy();
    expect(screen.getByText('Без портфеля')).toBeTruthy();
    expect(screen.getByText('4 / 7')).toBeTruthy();
  });

  it('архивные папки — отдельным блоком «Архив»', () => {
    renderRail();

    expect(screen.getByText('Архив')).toBeTruthy();
    expect(screen.getByText('Старый объект')).toBeTruthy();
  });

  it('пустая колонка — только «Все проекты» и «Без портфеля»', () => {
    renderRail({ tree: buildPortfolioFolders([], []) });

    expect(screen.getByText('Все проекты')).toBeTruthy();
    expect(screen.getByText('Без портфеля')).toBeTruthy();
    expect(screen.getByText('Портфелей пока нет')).toBeTruthy();
    expect(screen.queryByText('Архив')).not.toBeTruthy();
  });

  it('клик по портфелю и по «Без портфеля» — выбор папки журнала', () => {
    const props = renderRail();

    fireEvent.click(screen.getByText('Нежин-Недра'));
    expect(props.onSelect).toHaveBeenCalledWith(METRO.id);

    fireEvent.click(screen.getByText('Без портфеля'));
    expect(props.onSelect).toHaveBeenCalledWith('none');
  });

  it('внутри выбранной папки — строки «действует / завершён / в архиве»', () => {
    const props = renderRail({ selection: METRO.id });

    fireEvent.click(screen.getByRole('button', { name: /Действует/ }));
    expect(props.onStatus).toHaveBeenCalledWith('active');
  });

  it('повторный клик по активному статусу снимает фильтр', () => {
    const props = renderRail({ selection: METRO.id, status: 'completed' });

    fireEvent.click(screen.getByRole('button', { name: /Завершён/ }));
    expect(props.onStatus).toHaveBeenCalledWith('all');
  });

  it('перетаскивание проекта на папку — бросок с её id', () => {
    const props = renderRail({ draggingProjectId: 'project-1' });
    const row = screen.getByText('Нежин-Недра').closest('[role="button"]') as HTMLElement;

    fireEvent.dragOver(row, { dataTransfer: { dropEffect: '' } });
    fireEvent.drop(row, { dataTransfer: { dropEffect: '' } });

    expect(props.onDropProject).toHaveBeenCalledWith(METRO.id);
  });

  it('«Без портфеля» принимает бросок (убрать из портфеля), «Все проекты» — нет', () => {
    const props = renderRail({ draggingProjectId: 'project-1' });

    fireEvent.drop(screen.getByText('Без портфеля').closest('[role="button"]') as HTMLElement);
    expect(props.onDropProject).toHaveBeenCalledWith('none');

    fireEvent.drop(screen.getByText('Все проекты').closest('[role="button"]') as HTMLElement);
    expect(props.onDropProject).toHaveBeenCalledOnce();
  });

  it('архивная папка бросок не принимает — проекты живут в живых портфелях', () => {
    const props = renderRail({ draggingProjectId: 'project-1' });

    fireEvent.drop(screen.getByText('Старый объект').closest('[role="button"]') as HTMLElement);
    expect(props.onDropProject).not.toHaveBeenCalled();
  });

  it('создание портфеля инлайн: «+» → поле → Enter создаёт папку', () => {
    const props = renderRail();

    fireEvent.click(screen.getByRole('button', { name: 'Новый портфель' }));
    const input = screen.getByPlaceholderText('Например: Метро, линия 4');
    fireEvent.change(input, { target: { value: 'Нежин-Недра 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onCreate).toHaveBeenCalledWith('Нежин-Недра 2');
  });

  it('без project.create кнопки создания нет; без project.manage нет меню папки', () => {
    renderRail({ canCreate: false, canManage: false });

    expect(screen.queryByRole('button', { name: 'Новый портфель' })).not.toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Действия строки' })).not.toBeTruthy();
  });

  it('меню есть только у настоящих портфелей, не у «Все проекты»/«Без портфеля»', () => {
    renderRail();

    const pseudoRows = ['Все проекты', 'Без портфеля'].map(
      (label) => screen.getByText(label).closest('[role="button"]') as HTMLElement,
    );
    for (const pseudo of pseudoRows) {
      // PATCH/DELETE /projects/groups/all|none дал бы 400 — действий нет.
      expect(within(pseudo).queryByRole('button', { name: 'Действия строки' })).toBeNull();
    }
    // Живая и архивная папки — действия есть (переименовать / архив / вернуть).
    expect(screen.getAllByRole('button', { name: 'Действия строки' })).toHaveLength(2);
  });

  it('архивная папка без проектов видна в «Архиве» и возвращается из него', async () => {
    const props = renderRail({
      tree: buildPortfolioFolders([METRO, EMPTY_ARCHIVED], COUNTS),
    });

    expect(screen.getByText('Архив')).toBeTruthy();
    const row = screen.getByText('Пустой архив').closest('[role="button"]') as HTMLElement;
    expect(within(row).getByText('0 / 0')).toBeTruthy();

    const menuButton = within(row).getByRole('button', { name: 'Действия строки' });
    fireEvent.pointerDown(menuButton, { button: 0, pointerType: 'mouse' });
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Вернуть портфель' }));

    expect(props.onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ id: EMPTY_ARCHIVED.id, archived: true }),
    );
  });

  it('в режиме «Мои» строка называется «Мои проекты»', () => {
    renderRail({ allLabel: 'Мои проекты' });

    expect(screen.getByText('Мои проекты')).toBeTruthy();
    expect(screen.queryByText('Все проекты')).toBeNull();
  });

  it('меню живой папки: переименование и архив зовут свои действия', async () => {
    const props = renderRail();
    const row = screen.getByText(METRO.name).closest('[role="button"]') as HTMLElement;

    const open = async () => {
      const button = within(row).getByRole('button', { name: 'Действия строки' });
      fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
      fireEvent.click(button);
    };

    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }));
    expect(props.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: METRO.id }));

    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Архивировать портфель' }));
    expect(props.onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: METRO.id }));
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it('длинное имя папки целиком лежит в title (обрезается только визуально)', () => {
    const long: ProjectGroup = {
      id: '42000000-0000-4000-8000-000000000009',
      name: 'Очень длинный портфель большого объекта с десятками договоров',
      archivedAt: null,
    };
    renderRail({ tree: buildPortfolioFolders([long], []) });

    expect(screen.getByText(long.name).getAttribute('title')).toBe(long.name);
  });

  it('отмена инлайн-создания: Esc убирает поле и не создаёт папку', () => {
    const props = renderRail();

    fireEvent.click(screen.getByRole('button', { name: 'Новый портфель' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Например: Метро, линия 4'), { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Например: Метро, линия 4')).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});
