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
 * Журнал «Проекты» (#559): полоса папок-портфелей над журналом и её связь с
 * серверными фильтрами журнала — клик по папке, статусы, режим «Все/Мои»,
 * создание проекта с предзаполненным портфелем. Хуки замоканы: проверяем
 * поведение страницы, а не сеть.
 */
const mocks = vi.hoisted(() => ({
  journal: vi.fn(),
  groups: vi.fn(),
  counts: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
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
  useDeleteProjectGroup: () => ({ mutate: mocks.deleteGroup }),
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

/** Открыть список папок кнопкой «Портфели». */
function openFolders() {
  fireEvent.click(screen.getByRole('button', { name: /^Портфели/ }));
}

/** Строка папки в открытом списке «Портфели». */
function folderRow(name: string): HTMLElement {
  return screen.getByText(name).closest('button') as HTMLElement;
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

describe('журнал «Проекты»: кнопка «Портфели» (#559)', () => {
  it('раскрывает список папок: «Все проекты», портфели со счётчиками и «Без портфеля»', () => {
    render(<ProjectsPage />);
    openFolders();

    expect(screen.getByText(ui.projects.portfolioAllProjects)).toBeTruthy();
    expect(screen.getByText(PORTFOLIO.name)).toBeTruthy();
    expect(screen.getByText('98 / 100')).toBeTruthy();
    expect(screen.getByText(ui.projects.portfolioNone)).toBeTruthy();
    // Строки журнала на месте: таблица показывает договоры.
    expect(screen.getByText(ACTIVE_PROJECT.name)).toBeTruthy();
    // Справочник папок без режима «с архивом», счётчики — по режиму «Все».
    expect(mocks.groups).toHaveBeenCalledWith();
    expect(mocks.counts).toHaveBeenLastCalledWith('all');
  });

  it('выбранная папка называет кнопку — и не дублируется чипом в строке фильтров', async () => {
    render(<ProjectsPage />);

    openFolders();
    fireEvent.click(screen.getByText(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));

    // Кнопка носит имя папки и остаётся нейтральной (без подсветки выбора).
    const trigger = screen.getByRole('button', { name: /^Портфели/ });
    expect(trigger.textContent).toContain(PORTFOLIO.name);
    expect(trigger.className.split(/\s+/)).not.toContain('bg-accent');
    // Чипа «Портфели: …» в поле поиска нет — имя показывает кнопка.
    expect(screen.queryByText(/^Портфели:/)).toBeNull();
  });

  it('клик по папке ставит фильтр журнала, «Все проекты» — снимает', async () => {
    render(<ProjectsPage />);

    openFolders();
    fireEvent.click(screen.getByText(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));

    openFolders();
    fireEvent.click(screen.getByText(ui.projects.portfolioAllProjects));
    await waitFor(() => expect(lastFilters().portfolioId).toBeUndefined());
  });

  it('«Без портфеля» — фильтр-сентинел none', async () => {
    render(<ProjectsPage />);

    openFolders();
    fireEvent.click(screen.getByText(ui.projects.portfolioNone));
    await waitFor(() => expect(lastFilters().portfolioId).toBe('none'));
  });

  it('смена папки переключает серверный фильтр журнала', async () => {
    render(<ProjectsPage />);

    openFolders();
    fireEvent.click(screen.getByText(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));

    openFolders();
    fireEvent.click(screen.getByText(ui.projects.portfolioNone));
    await waitFor(() => expect(lastFilters().portfolioId).toBe('none'));
  });

  it('режим «Мои»: счётчики по моему участию и подпись «Мои проекты»', async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole('radio', { name: ui.projects.scopeMine }));

    await waitFor(() => expect(mocks.counts).toHaveBeenLastCalledWith('mine'));
    openFolders();
    expect(screen.getByText(ui.projects.portfolioMyProjects)).toBeTruthy();
    expect(lastFilters().scope).toBe('mine');
  });

  it('«Создать» из папки предзаполняет портфель, из «Все проекты» — нет', async () => {
    render(<ProjectsPage />);

    openFolders();
    fireEvent.click(screen.getByText(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(mocks.openCreate).toHaveBeenLastCalledWith({ portfolioId: PORTFOLIO.id });

    openFolders();
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

  it('папка — настоящая кнопка (Enter/Space обрабатывает браузер)', async () => {
    render(<ProjectsPage />);
    openFolders();

    expect(folderRow(PORTFOLIO.name).tagName).toBe('BUTTON');
    fireEvent.click(folderRow(PORTFOLIO.name));
    await waitFor(() => expect(lastFilters().portfolioId).toBe(PORTFOLIO.id));
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
