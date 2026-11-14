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
 * Действия журнала проектов (#559): drag строки на папку, меню папки и
 * строки, окна портфеля. Хуки API замоканы — проверяем проводку действий
 * страницы до мутаций (I4), а не сеть.
 */
const mocks = vi.hoisted(() => ({
  journal: vi.fn(),
  groups: vi.fn(),
  counts: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  archiveGroup: vi.fn(),
  restoreGroup: vi.fn(),
  statusMutate: vi.fn(),
  moveMutate: vi.fn(),
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
  useArchiveProjectGroup: () => ({ mutate: mocks.archiveGroup }),
  useRestoreProjectGroup: () => ({ mutate: mocks.restoreGroup }),
}));
vi.mock('../api/project-mutations.js', () => ({
  useProjectStatus: () => ({ mutate: mocks.statusMutate }),
}));
vi.mock('../api/project-portfolio-mutation.js', () => ({
  useMoveProjectPortfolio: () => ({ mutate: mocks.moveMutate }),
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

function folderRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="button"]') as HTMLElement;
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

const DATA_TRANSFER = () => ({ setData: vi.fn(), effectAllowed: '' });

function dragProject(rowName: string) {
  fireEvent.dragStart(tableRow(rowName), { dataTransfer: DATA_TRANSFER() });
}

function dropOn(folderName: string) {
  const folder = folderRow(folderName);
  fireEvent.dragOver(folder, { dataTransfer: { dropEffect: '' } });
  fireEvent.drop(folder);
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

describe('перетаскивание проекта на папку (#559)', () => {
  it('бросок на другую папку меняет портфель проекта', () => {
    render(<ProjectsPage />);

    dragProject(ARCHIVED_PROJECT.name);
    dropOn(PORTFOLIO.name);
    // Конец перетаскивания сбрасывает подсветку и не дублирует запрос.
    fireEvent.dragEnd(tableRow(ARCHIVED_PROJECT.name));

    expect(mocks.moveMutate).toHaveBeenCalledTimes(1);
    expect(mocks.moveMutate).toHaveBeenCalledWith({
      id: ARCHIVED_PROJECT.id,
      portfolioId: PORTFOLIO.id,
    });
  });

  it('«Без портфеля» — portfolioId: null', () => {
    render(<ProjectsPage />);

    dragProject(ARCHIVED_PROJECT.name);
    dropOn(ui.projects.portfolioNone);

    expect(mocks.moveMutate).toHaveBeenCalledWith({
      id: ARCHIVED_PROJECT.id,
      portfolioId: null,
    });
  });

  it('бросок в ту же папку сеть не дёргает', () => {
    render(<ProjectsPage />);

    dragProject(ACTIVE_PROJECT.name);
    dropOn(PORTFOLIO.name);

    expect(mocks.moveMutate).not.toHaveBeenCalled();
  });

  it('подсветка папки: dragOver включает, dragLeave снимает (броска нет)', () => {
    render(<ProjectsPage />);
    dragProject(ARCHIVED_PROJECT.name);

    const folder = folderRow(PORTFOLIO.name);
    fireEvent.dragOver(folder, { dataTransfer: { dropEffect: '' } });
    expect(folder.className).toContain('ring-ring');

    fireEvent.dragLeave(folder);
    expect(folder.className).not.toContain('ring-ring');
    expect(mocks.moveMutate).not.toHaveBeenCalled();
  });

  it('архивный проект тянет только project.manage; живой — руководство проекта', () => {
    authWith([Permission.PROJECT_CREATE]);
    render(<ProjectsPage />);

    expect(tableRow(ARCHIVED_PROJECT.name).hasAttribute('draggable')).toBe(false);
    expect(tableRow(ACTIVE_PROJECT.name).getAttribute('draggable')).toBe('true');
  });

  it('клик по «⋯» папки не выбирает папку (меню не всплывает до строки)', () => {
    render(<ProjectsPage />);
    openMenu(folderRow(PORTFOLIO.name));

    // Журнал запрошен только начальным состоянием — фильтра папки нет.
    const filters = mocks.journal.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(filters.portfolioId).toBeUndefined();
  });
});

describe('создание портфеля из колонки (#559)', () => {
  it('Enter создаёт папку, Esc отменяет без запроса', () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole('button', { name: ui.projects.portfolioCreate }));
    const input = screen.getByRole('textbox', { name: ui.projects.portfolioCreate });
    fireEvent.change(input, { target: { value: 'Новый портфель' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.createGroup).toHaveBeenCalledWith('Новый портфель');

    fireEvent.click(screen.getByRole('button', { name: ui.projects.portfolioCreate }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: ui.projects.portfolioCreate }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('textbox', { name: ui.projects.portfolioCreate })).toBeNull();
    expect(mocks.createGroup).toHaveBeenCalledTimes(1);
  });
});

describe('окна и меню портфеля (#559)', () => {
  it('переименование: окно с текущим именем, сохранение зовёт мутацию', async () => {
    render(<ProjectsPage />);
    openMenu(folderRow(PORTFOLIO.name));
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
    openMenu(folderRow(PORTFOLIO.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioRename }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));

    expect(mocks.renameGroup).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('архив папки: «Отмена» окна ничего не архивирует, подтверждение — зовёт мутацию', async () => {
    render(<ProjectsPage />);
    openMenu(folderRow(PORTFOLIO.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioArchive }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));
    expect(mocks.archiveGroup).not.toHaveBeenCalled();

    openMenu(folderRow(PORTFOLIO.name));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioArchive }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: ui.projects.portfolioArchive }));
    expect(mocks.archiveGroup).toHaveBeenCalledWith(PORTFOLIO.id);
  });

  it('возврат архивной папки из меню «Архив»', async () => {
    render(<ProjectsPage />);
    openMenu(folderRow('Старый объект'));
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.portfolioRestore }));

    expect(mocks.restoreGroup).toHaveBeenCalledWith('42000000-0000-4000-8000-000000000002');
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
