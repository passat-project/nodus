// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Permission, ui } from '@nodus/contracts';

import {
  ACTIVE_PROJECT,
  ARCHIVED_PROJECT,
  COUNTS,
  GROUPS,
  PORTFOLIO,
  journalData,
} from '../fixtures/journal.js';
import { ProjectsPage } from './projects-page.js';
import { useAuthStore } from '../../../shared/auth-store.js';

/**
 * Действия журнала проектов (#559): меню папки и строки, окна портфеля.
 * Хуки API замоканы — проверяем проводку действий страницы до мутаций (I4),
 * а не сеть.
 */
const mocks = vi.hoisted(() => ({
  journal: vi.fn(),
  groups: vi.fn(),
  counts: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
  statusMutate: vi.fn(),
  openCreate: vi.fn(),
  openCard: vi.fn(),
}));

vi.mock('../api/projects-api.js', () => ({
  useProjectGroups: mocks.groups,
  useProjectsJournal: mocks.journal,
}));
vi.mock('../api/portfolio-counts.js', () => ({
  useProjectPortfolioCounts: mocks.counts,
}));
vi.mock('../api/project-catalog-mutations.js', () => ({
  useCreateProjectGroup: () => ({ mutate: mocks.createGroup }),
  useRenameProjectGroup: () => ({ mutate: mocks.renameGroup }),
  useDeleteProjectGroup: () => ({ mutate: mocks.deleteGroup }),
}));
vi.mock('../api/project-mutations.js', () => ({
  useProjectStatus: () => ({ mutate: mocks.statusMutate }),
}));
vi.mock('../../../shared/views/project-table-fields.js', () => {
  const fields = [
    {
      id: 'name',
      label: 'Название',
      defaultVisible: true,
      render: (row: { name: string }) => row.name,
    },
  ];
  return { useProjectTableFields: () => fields };
});
vi.mock('../../../shared/views/project-filter-fields.js', () => {
  const presets: unknown[] = [];
  return { projectBuiltinPresets: presets, useProjectFilterDefs: () => [] };
});
vi.mock('../../../shared/views/view-settings.js', () => ({ ViewSettings: () => null }));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => mocks.openCard }));
vi.mock('../../../shared/projects/project-create-store.js', () => ({
  openProjectCreate: mocks.openCreate,
}));

const ME = '20000000-0000-4000-8000-000000000001';

function authWith(permissions: string[]) {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    user: { id: ME, email: 'me@nodus.by', displayName: 'Я Первый', permissions, modules: [] },
  } as never);
}

/** Открыть список папок кнопкой «Портфели». */
function openFolders() {
  fireEvent.click(screen.getByRole('button', { name: /^Портфели/ }));
}

/** Строка папки в открытом списке «Портфели» (контейнер с кнопкой и «⋯»). */
function folderRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-folder-row]') as HTMLElement;
}

/** Меню настройки папки прямо в строке списка. */
function openFolderMenu(name: string) {
  openFolders();
  const button = within(folderRow(name)).getByRole('button', { name: ui.common.rowMenu });
  fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
  fireEvent.click(button);
}

function tableRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="row"]') as HTMLElement;
}

/** Меню строки/папки: Radix открывается pointerdown, затем click. */
function openMenu(scope: HTMLElement) {
  const button = within(scope).getByRole('button', { name: ui.common.rowMenu });
  fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
  fireEvent.click(button);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  authWith([Permission.PROJECT_MANAGE, Permission.PROJECT_CREATE]);
  mocks.journal.mockReturnValue(journalData([ACTIVE_PROJECT, ARCHIVED_PROJECT]));
  mocks.groups.mockReturnValue({ data: GROUPS });
  mocks.counts.mockReturnValue({ data: COUNTS });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('журнал без перетаскивания на портфели (#1014)', () => {
  it('строка проекта не тянется, бросок на папку не открывает поповер и не меняет портфель', () => {
    render(<ProjectsPage />);

    const row = tableRow(ACTIVE_PROJECT.name);
    expect(row.hasAttribute('draggable')).toBe(false);
    expect(row.className).not.toContain('cursor-grab');

    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    // Поповер «Портфели» сам не открылся — цели броска в DOM нет.
    expect(screen.queryByText(PORTFOLIO.name)).toBeNull();

    fireEvent.dragEnd(row);
    expect(screen.queryByText(PORTFOLIO.name)).toBeNull();
  });
});

describe('создание портфеля из вкладки «Портфели» (#559)', () => {
  it('Enter создаёт папку, Esc отменяет без запроса', () => {
    render(<ProjectsPage />);
    openFolders();

    fireEvent.click(screen.getByRole('button', { name: ui.projects.portfolioCreate }));
    const input = screen.getByRole('textbox', { name: ui.projects.portfolioCreate });
    fireEvent.change(input, { target: { value: 'Новый портфель' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.createGroup).toHaveBeenCalledWith('Новый портфель');

    openFolders();
    fireEvent.click(screen.getByRole('button', { name: ui.projects.portfolioCreate }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: ui.projects.portfolioCreate }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('textbox', { name: ui.projects.portfolioCreate })).toBeNull();
    expect(mocks.createGroup).toHaveBeenCalledTimes(1);
  });
});

describe('настройка портфеля в попапе (#559)', () => {
  it('переименование: окно с текущим именем, сохранение зовёт мутацию', async () => {
    render(<ProjectsPage />);
    openFolderMenu(PORTFOLIO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioRename }));

    const input = (await screen.findByRole('textbox', {
      name: ui.projects.fieldName,
    })) as HTMLInputElement;
    expect(input.value).toBe(PORTFOLIO.name);

    fireEvent.change(input, { target: { value: 'Нежин-Недра 2' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));

    expect(mocks.renameGroup).toHaveBeenCalledWith({
      id: PORTFOLIO.id,
      name: 'Нежин-Недра 2',
    });
  });

  it('переименование: «Отмена» закрывает окно без мутации', async () => {
    render(<ProjectsPage />);
    openFolderMenu(PORTFOLIO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioRename }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));

    expect(mocks.renameGroup).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('удаление портфеля: окно предупреждает о переносе проектов, «Отмена» — без мутации', async () => {
    render(<ProjectsPage />);
    openFolderMenu(PORTFOLIO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioDelete }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(ui.projects.portfolioDeleteConfirmBody)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));
    expect(mocks.deleteGroup).not.toHaveBeenCalled();
  });

  it('удаление портфеля: подтверждение зовёт мутацию удаления', async () => {
    render(<ProjectsPage />);
    openFolderMenu(PORTFOLIO.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioDelete }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.projects.portfolioDelete }));

    expect(mocks.deleteGroup).toHaveBeenCalledWith(PORTFOLIO.id);
  });
});

describe('меню строки проекта', () => {
  it('«Завершить» зовёт статусную мутацию', async () => {
    render(<ProjectsPage />);
    openMenu(tableRow(ACTIVE_PROJECT.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.statusComplete }));

    expect(mocks.statusMutate).toHaveBeenCalledWith({
      id: ACTIVE_PROJECT.id,
      status: 'completed',
    });
  });

  it('«В архив» — окно подтверждения, отмена не архивирует', async () => {
    render(<ProjectsPage />);
    openMenu(tableRow(ACTIVE_PROJECT.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.statusArchive }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(ACTIVE_PROJECT.name)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));
    expect(mocks.statusMutate).not.toHaveBeenCalled();
  });

  it('«В архив» подтверждённый — статус archived у проекта', async () => {
    render(<ProjectsPage />);
    openMenu(tableRow(ACTIVE_PROJECT.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.statusArchive }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.projects.statusArchive }));

    expect(mocks.statusMutate).toHaveBeenCalledWith({
      id: ACTIVE_PROJECT.id,
      status: 'archived',
    });
  });

  it('архивный проект — «Вернуть в работу»', async () => {
    render(<ProjectsPage />);
    openMenu(tableRow(ARCHIVED_PROJECT.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.statusReactivate }));

    expect(mocks.statusMutate).toHaveBeenCalledWith({
      id: ARCHIVED_PROJECT.id,
      status: 'active',
    });
  });

  it('клик по строке открывает карточку проекта', () => {
    render(<ProjectsPage />);
    fireEvent.click(tableRow(ACTIVE_PROJECT.name));

    expect(mocks.openCard).toHaveBeenCalledWith(
      { kind: 'project', id: ACTIVE_PROJECT.id },
      expect.anything(),
    );
  });
});
