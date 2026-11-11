// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeKind,
  ProjectNode,
  ProjectStructureResponse,
  ProjectType,
  TaskListItem,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const {
  PROJECT_ID,
  TYPE_ID,
  B1_ID,
  AR_ID,
  TASK_IN_ID,
  TASK_OUT_ID,
  NOTE_ID,
  ME_ID,
  apiMock,
  setTasksNodeMutate,
  world,
} = vi.hoisted(() => ({
  PROJECT_ID: '12000000-0000-4000-8000-000000000001',
  TYPE_ID: '41000000-0000-4000-8000-0000000000e1',
  B1_ID: '43000000-0000-4000-8000-000000000001',
  AR_ID: '43000000-0000-4000-8000-000000000002',
  TASK_IN_ID: '21000000-0000-4000-8000-000000000001',
  TASK_OUT_ID: '21000000-0000-4000-8000-000000000002',
  NOTE_ID: 'c0000000-0000-4000-8000-0000000000f3',
  ME_ID: '11000000-0000-4000-8000-000000000001',
  // Превью переноса ходит настоящим хуком через api(): мок сети — на клиенте.
  apiMock: vi.fn(),
  setTasksNodeMutate: vi.fn(),
  world: { structure: null as ProjectStructureResponse | null },
}));

/** StructureTab (#632, A9-1), перенос задач со сводным превью: вынесено из
 *  structure-tab.test.tsx (лимит строк файла, как structure-tab-filter) —
 *  моки и хелперы продублированы. */

vi.mock('../../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));

vi.mock('../../../../shared/api-client.js', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../../../shared/auth-store.js', () => {
  const state = { user: { id: ME_ID, permissions: [], modules: ['projects'] } };
  // projectsAvailable() зовёт СТАТИКУ useAuthStore.getState() — она обязана
  // быть на хуке, иначе мок падает на импорте соседних модулей.
  const useAuthStore = (selector: (s: typeof state) => unknown) => selector(state);
  return { useAuthStore: Object.assign(useAuthStore, { getState: () => state }) };
});

vi.mock('../../../../shared/api/projects-list.js', () => ({
  projectsKeys: { all: ['projects'], types: () => ['projects'], detail: (id: string) => [id] },
  useProjectTypes: () => ({ data: TYPES, isLoading: false }),
  useProjectsList: () => ({ data: { items: [], nextCursor: null } }),
  useProjectGroups: () => ({ data: [] }),
}));

vi.mock('../../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({ data: { items: [] } }),
  useUsersSearch: () => ({ data: { items: [] }, isFetching: false }),
}));

vi.mock('../../../../shared/api/departments-list.js', () => ({ useDepartmentsList: () => [] }));

vi.mock('../../../../shared/dictionaries/queries.js', () => ({
  dictionariesKeys: { items: (code: string) => ['dictionaries', code] },
  fetchDictionaryItems: async () => [],
  useDictionaries: () => ({ data: [] }),
  useDictionaryItems: () => ({ data: [] }),
}));

vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));

vi.mock('../../../../shared/tasks/task-create-store.js', () => ({ openTaskCreate: vi.fn() }));

vi.mock('../api/structure-api.js', () => ({
  structureKeys: { of: (projectId: string) => ['projects', 'structure', projectId] },
  useProjectStructure: () => ({ data: world.structure, isLoading: false }),
  useMoveNode: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateNode: () => ({ mutate: vi.fn(), isPending: false }),
  useBatchCreateNodes: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNode: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteNode: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../api/structure-task-mutations.js', () => ({
  useMoveTaskNode: () => ({ mutate: vi.fn(), isPending: false }),
  useSetTasksNode: () => ({ mutate: setTasksNodeMutate, isPending: false }),
}));

vi.mock('../../api/projects-api.js', () => ({
  useProjectDetail: () => ({
    data: { id: PROJECT_ID, name: 'Главный корпус', type: { id: TYPE_ID, name: 'Договор' } },
  }),
  useProjectTaskPages: () => ({ data: { pages: [{ items: TASKS, nextCursor: null }] } }),
}));

vi.mock('../../node-kinds/api/node-kinds-api.js', () => ({ useRefreshNodeKinds: () => vi.fn() }));

import { StructureTab } from './structure-tab.js';

const ZERO_ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
} as const;

const BUILDING: NodeKind = {
  id: '44000000-0000-4000-8000-000000000004',
  name: 'Здание по генплану',
  icon: 'building',
  color: 'sky',
  archivedAt: null,
  form: { fields: [] },
  capabilities: [],
};
const SECTION: NodeKind = {
  ...BUILDING,
  id: '44000000-0000-4000-8000-000000000005',
  name: 'Раздел',
  icon: 'listTree',
  color: 'pink',
};

const TYPES: ProjectType[] = [
  {
    id: TYPE_ID,
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    kindIds: null,
    archivedAt: null,
    form: { fields: [] },
  },
];

const USER = { id: ME_ID, displayName: 'Клевантович А.', avatarUrl: null };

function nodeOf(id: string, parentId: string | null, name: string): ProjectNode {
  return {
    id,
    parentId,
    kindId: parentId ? SECTION.id : BUILDING.id,
    name,
    code: null,
    customFields: {},
    rollup: ZERO_ROLLUP,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function taskOf(id: string, number: number, title: string, nodeId: string | null): TaskListItem {
  return {
    id,
    number,
    title,
    type: {
      id: '31000000-0000-4000-8000-000000000001',
      code: 'std',
      name: 'Стандартный',
      category: 'task',
      icon: 'square-check',
      color: 'teal',
    },
    stage: {
      id: '32000000-0000-4000-8000-000000000001',
      name: 'В работе',
      order: 0,
      systemState: 'active',
      color: 'info',
      outcome: null,
    },
    personalStageId: null,
    priority: 'normal',
    deadline: null,
    creator: USER,
    assignee: USER,
    participants: [],
    project: { id: PROJECT_ID, code: '22-01', name: 'Главный корпус', color: 'blue' },
    parentId: null,
    nodeId,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    customFields: {},
    updatedAt: '2026-11-01T09:00:00.000Z',
  };
}

const TASKS: TaskListItem[] = [
  taskOf(TASK_IN_ID, 201, 'Согласовать АР', AR_ID),
  taskOf(TASK_OUT_ID, 202, 'Задача вне структуры', null),
];

/** Дерево: «Здание 1» → «Раздел АР» с задачей; вторая задача — «Без папки». */
function structure(): ProjectStructureResponse {
  return {
    nodes: [nodeOf(B1_ID, null, 'Здание 1'), nodeOf(AR_ID, B1_ID, 'Раздел АР')],
    kinds: [BUILDING, SECTION],
    customFieldRefs: [],
  };
}

// Подвод к краю скроллит контейнер ResizeObserver-ом — jsdom его не даёт.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTab() {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StructureTab projectId={PROJECT_ID} canManage readOnly={false} />
    </QueryClientProvider>,
  );
}

describe('StructureTab: перенос задач со сводным превью формул (A9-1)', () => {
  beforeEach(() => {
    localStorage.clear();
    world.structure = structure();
    apiMock.mockReset();
    apiMock.mockResolvedValue({ changes: [] });
    setTasksNodeMutate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('мультиселект спрашивает сводку диффа до записи, перенос — после «Перенести»', async () => {
    // Превью каждой задачи: запись диффа помечена хостом из пути маршрута.
    apiMock.mockImplementation(async (url: string) => ({
      changes: [
        {
          hostKind: 'task',
          hostId: url.split('/')[2] ?? TASK_IN_ID,
          fieldId: NOTE_ID,
          hostLabel: url.includes(TASK_IN_ID) ? 'Согласовать АР' : 'Задача вне структуры',
          fieldName: 'Шифр',
          from: 'А-1',
          to: 'Б-2',
        },
      ],
    }));
    renderTab();

    // Мультиселект: задача раздела и задача «Без папки».
    for (const title of ['Согласовать АР', 'Задача вне структуры']) {
      const row = screen.getByText(title).closest('[role="row"]') as HTMLElement;
      fireEvent.click(within(row).getByRole('checkbox', { name: ui.common.selectRow }));
    }
    fireEvent.click(screen.getByRole('button', { name: ui.structure.moveTasksTo }));

    // Окно выбора цели: по умолчанию «Без папки» — цель не меняем.
    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));

    // Сводка ДО записи: обе задачи в одном окне, мутации нет.
    const title = await screen.findByText(ui.formulas.move.title);
    const preview = title.closest('[role="dialog"]') as HTMLElement;
    expect(within(preview).getByText('Согласовать АР')).toBeTruthy();
    expect(within(preview).getByText('Задача вне структуры')).toBeTruthy();
    expect(setTasksNodeMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.formulas.move.confirm }));
    expect(setTasksNodeMutate).toHaveBeenCalledTimes(1);
    expect(setTasksNodeMutate.mock.calls[0]?.[0]).toEqual({
      taskIds: [TASK_IN_ID, TASK_OUT_ID],
      nodeId: null,
    });
  });

  it('пустой дифф пачки — перенос сразу, окна подтверждения нет', async () => {
    renderTab();

    for (const title of ['Согласовать АР', 'Задача вне структуры']) {
      const row = screen.getByText(title).closest('[role="row"]') as HTMLElement;
      fireEvent.click(within(row).getByRole('checkbox', { name: ui.common.selectRow }));
    }
    fireEvent.click(screen.getByRole('button', { name: ui.structure.moveTasksTo }));
    fireEvent.click(screen.getByRole('button', { name: ui.structure.move }));

    // Превью отвечает микрозадачей: перенос приходит после ответа сервера.
    await waitFor(() => expect(setTasksNodeMutate).toHaveBeenCalledTimes(1));
    expect(setTasksNodeMutate.mock.calls[0]?.[0]).toEqual({
      taskIds: [TASK_IN_ID, TASK_OUT_ID],
      nodeId: null,
    });
    expect(screen.queryByText(ui.formulas.move.title)).toBeNull();
  });
});
