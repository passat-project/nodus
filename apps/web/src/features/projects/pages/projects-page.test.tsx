// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
 * Журнал «Проекты» (#559): левая колонка папок-портфелей и её связь с
 * серверными фильтрами журнала — клик по папке, строки статусов, режим
 * «Все/Мои», создание проекта с предзаполненным портфелем. Хуки замоканы:
 * проверяем поведение страницы, а не сеть.
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

/** Строка папки левой колонки по её названию. */
function folderRow(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="button"]') as HTMLElement;
}

/** Фильтры последнего запроса журнала. */
function lastFilters(): Record<string, unknown> {
  return mocks.journal.mock.calls.at(-1)![0] as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    user: {
      id: '20000000-0000-4000-8000-000000000001',
      email: 'me@nodus.by',
      displayName: 'Я Первый',
      permissions: [Permission.PROJECT_MANAGE, Permission.PROJECT_CREATE],
      modules: [],
    },
  });
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

describe('журнал «Проекты»: колонка папок (#559)', () => {
  it('рисует «Все проекты», портфели со счётчиками, «Без портфеля» и архив', () => {
    render(<ProjectsPage />);

    expect(screen.getByText(ui.projects.portfolioAllProjects)).toBeTruthy();
    expect(screen.getByText(PORTFOLIO.name)).toBeTruthy();
    expect(screen.getByText('98 / 100')).toBeTruthy();
    expect(screen.getByText(ui.projects.portfolioNone)).toBeTruthy();
    expect(screen.getByText(ui.projects.portfolioArchivedSection)).toBeTruthy();
    // Строки журнала на месте: таблица показывает договоры.
    expect(screen.getByText(ACTIVE_PROJECT.name)).toBeTruthy();
    // Справочник папок запрошен вместе с архивом, счётчики — по режиму «Все».
    expect(mocks.groups).toHaveBeenCalledWith(true);
    expect(mocks.counts).toHaveBeenLastCalledWith('all');
  });

  it('клик по папке ставит фильтр журнала, «Все проекты» — снимает', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByText(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));

    fireEvent.click(screen.getByText(ui.projects.portfolioAllProjects));
    await waitFor(() => expect(lastFilters().portfolioId).toBeUndefined());
  });

  it('«Без портфеля» — фильтр-сентинел none', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByText(ui.projects.portfolioNone));
    await waitFor(() => expect(lastFilters().portfolioId).toBe('none'));
  });

  it('внутри папки строки статусов сужают журнал, повторный клик снимает', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByText(PORTFOLIO.name));
    fireEvent.click(await screen.findByRole('button', { name: /Действует/ }));
    await waitFor(() => expect(lastFilters().status).toBe('active'));

    fireEvent.click(await screen.findByRole('button', { name: /Действует/ }));
    await waitFor(() => expect(lastFilters().status).toBeUndefined());
  });

  it('смена папки сбрасывает статус: папка открывается «всеми» статусами', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByText(PORTFOLIO.name));
    fireEvent.click(await screen.findByRole('button', { name: /Завершён/ }));
    await waitFor(() => expect(lastFilters().status).toBe('completed'));

    fireEvent.click(screen.getByText(ui.projects.portfolioNone));
    await waitFor(() => expect(lastFilters().status).toBeUndefined());
    expect(lastFilters().portfolioId).toBe('none');
  });

  it('режим «Мои»: счётчики по моему участию и подпись «Мои проекты»', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole('radio', { name: ui.projects.scopeMine }));

    await waitFor(() => expect(mocks.counts).toHaveBeenLastCalledWith('mine'));
    expect(screen.getByText(ui.projects.portfolioMyProjects)).toBeTruthy();
    expect(lastFilters().scope).toBe('mine');
    expect(localStorage.getItem('nodus-projects-scope-v1')).toBe('mine');
  });

  it('«Создать» из папки предзаполняет портфель, из «Все проекты» — нет', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByText(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(mocks.openCreate).toHaveBeenLastCalledWith({ portfolioId: PORTFOLIO.id });

    fireEvent.click(screen.getByText(ui.projects.portfolioAllProjects));
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(mocks.openCreate).toHaveBeenLastCalledWith({});
  });

  it('пустой результат фильтра — «ничего не найдено», а не «проектов нет»', async () => {
    mocks.journal.mockReturnValue(journalData([]));
    render(<ProjectsPage />);

    fireEvent.change(screen.getByRole('textbox', { name: ui.common.search }), {
      target: { value: 'несуществующий' },
    });

    expect(await screen.findByText(ui.projects.journalEmptyFiltered)).toBeTruthy();
  });

  it('папка выбирается с клавиатуры (Enter и Space)', async () => {
    render(<ProjectsPage />);

    fireEvent.keyDown(folderRow(PORTFOLIO.name), { key: 'Enter' });
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));

    fireEvent.keyDown(folderRow(ui.projects.portfolioNone), { key: ' ' });
    await waitFor(() => expect(lastFilters().portfolioId).toBe('none'));
  });

  it('sentinel у дна журнала подгружает следующую страницу', async () => {
    const fetchNextPage = vi.fn();
    mocks.journal.mockReturnValue({
      ...journalData([ACTIVE_PROJECT]),
      hasNextPage: true,
      fetchNextPage,
    });
    let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          trigger = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    render(<ProjectsPage />);
    await waitFor(() => expect(trigger).not.toBeNull());
    trigger!([{ isIntersecting: true }]);

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
