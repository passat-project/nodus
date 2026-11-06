// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomFieldDefinition,
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
  NOTE_ID,
  ME_ID,
  openCard,
  openTaskCreate,
  moveNodeMutate,
  createNodeMutate,
  updateNodeMutate,
  world,
} = vi.hoisted(() => ({
  PROJECT_ID: '12000000-0000-4000-8000-000000000001',
  TYPE_ID: '41000000-0000-4000-8000-0000000000e1',
  B1_ID: '43000000-0000-4000-8000-000000000001',
  AR_ID: '43000000-0000-4000-8000-000000000002',
  TASK_IN_ID: '21000000-0000-4000-8000-000000000001',
  NOTE_ID: 'c0000000-0000-4000-8000-0000000000f3',
  ME_ID: '11000000-0000-4000-8000-000000000001',
  openCard: vi.fn(),
  openTaskCreate: vi.fn(),
  moveNodeMutate: vi.fn(),
  createNodeMutate: vi.fn(),
  updateNodeMutate: vi.fn(),
  // Переключаемое состояние мира: загрузка / пусто / дерево.
  world: { loading: true, structure: null as ProjectStructureResponse | null },
}));

/** StructureTab (#467, #631), фильтр по атрибутам: вынесено из
 *  structure-tab.test.tsx (лимит строк файла); моки и хелперы продублированы. */

const ZERO_ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
} as const;

function kind(
  id: string,
  name: string,
  icon: NodeKind['icon'],
  color: NodeKind['color'],
): NodeKind {
  return { id, name, icon, color, archivedAt: null, form: { fields: [] }, capabilities: [] };
}

const BUILDING = kind(
  '44000000-0000-4000-8000-000000000004',
  'Здание по генплану',
  'building',
  'sky',
);
const SECTION = kind('44000000-0000-4000-8000-000000000005', 'Раздел', 'listTree', 'pink');
const KINDS = [BUILDING, SECTION];

function nodeOf(
  id: string,
  parentId: string | null,
  name: string,
  customFields: ProjectNode['customFields'],
): ProjectNode {
  return {
    id,
    parentId,
    kindId: parentId ? SECTION.id : BUILDING.id,
    name,
    code: null,
    customFields,
    rollup: ZERO_ROLLUP,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

const USER = { id: ME_ID, displayName: 'Клевантович А.', avatarUrl: null };
const TASK_TYPE = {
  id: '31000000-0000-4000-8000-000000000001',
  code: 'std',
  name: 'Стандартный',
  category: 'task',
  icon: 'square-check',
  color: 'teal',
} as const;
const TASK_STAGE = {
  id: '32000000-0000-4000-8000-000000000001',
  name: 'В работе',
  order: 0,
  systemState: 'active',
  color: 'info',
  outcome: null,
} as const;

function taskOf(id: string, number: number, title: string, nodeId: string | null): TaskListItem {
  return {
    id,
    number,
    title,
    type: TASK_TYPE,
    stage: TASK_STAGE,
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

/** Дерево: Здание 1 (примечание «фасад») → раздел АР, задача в разделе +
 *  задача вне структуры («Без папки»). */
function treeStructure(): ProjectStructureResponse {
  return {
    nodes: [
      nodeOf(B1_ID, null, 'Здание 1', { [NOTE_ID]: 'Фасад — навесной' }),
      nodeOf(AR_ID, B1_ID, 'Раздел АР', {}),
    ],
    kinds: KINDS,
    customFieldRefs: [],
  };
}

const TREE_TASKS: TaskListItem[] = [
  taskOf(TASK_IN_ID, 201, 'Согласовать АР', AR_ID),
  taskOf('21000000-0000-4000-8000-000000000002', 202, 'Задача вне структуры', null),
];

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

function nodeDefinition(id: string, name: string): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: KINDS.map((k) => k.id) },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('../../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => openCard }));

vi.mock('../../../../shared/auth-store.js', () => {
  const state = { user: { id: ME_ID, permissions: ['project.setup.manage'] } };
  return {
    useAuthStore: (selector: (s: typeof state) => unknown) => selector(state),
    getState: () => state,
  };
});

vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: TYPES, isLoading: false }),
  useProjectsList: () => ({ data: { items: [], nextCursor: null } }),
  useProjectGroups: () => ({ data: [] }),
  usePortalSettings: () => ({ data: { projects: { defaultVisibility: 'open' } } }),
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
  useCustomFieldDefinitions: () => ({
    // Атрибут «Примечание» привязан к обоим видам папок дерева.
    data: [nodeDefinition(NOTE_ID, 'Примечание')],
  }),
}));

vi.mock('../../../../shared/tasks/task-create-store.js', () => ({ openTaskCreate }));

vi.mock('../api/structure-api.js', () => ({
  structureKeys: { of: (projectId: string) => ['projects', 'structure', projectId] },
  useProjectStructure: () => ({ data: world.structure, isLoading: world.loading }),
  useMoveNode: () => ({ mutate: moveNodeMutate, isPending: false }),
  useCreateNode: () => ({ mutate: createNodeMutate, isPending: false }),
  useBatchCreateNodes: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNode: () => ({ mutate: updateNodeMutate, isPending: false }),
  useDeleteNode: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../api/structure-task-mutations.js', () => ({
  useMoveTaskNode: () => ({ mutate: vi.fn(), isPending: false }),
  useSetTasksNode: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../api/projects-api.js', () => ({
  useProjectDetail: () => ({
    data: { id: PROJECT_ID, name: 'Главный корпус', type: { id: TYPE_ID, name: 'Договор' } },
  }),
  useProjectTaskPages: () => ({ data: { pages: [{ items: TREE_TASKS, nextCursor: null }] } }),
}));

vi.mock('../../node-kinds/api/node-kinds-api.js', () => ({ useRefreshNodeKinds: () => vi.fn() }));

import { StructureTab } from './structure-tab.js';

// Подвод к краю скроллит контейнер ResizeObserver-ом — jsdom его не даёт.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTab(props: { canManage?: boolean; readOnly?: boolean } = {}) {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StructureTab
        projectId={PROJECT_ID}
        canManage={props.canManage ?? true}
        readOnly={props.readOnly ?? false}
      />
    </QueryClientProvider>,
  );
}

describe('StructureTab: дерево папок с задачами и фильтр по атрибутам (#467, #631)', () => {
  beforeEach(() => {
    localStorage.clear();
    world.loading = true;
    world.structure = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('фильтр по атрибуту: совпадение с путём до корня, задачи и «Без папки» скрыты', () => {
    world.loading = false;
    world.structure = treeStructure();
    // Фильтры тулбара живут под ключом списка «projects.structure» (ширины
    // колонок — отдельный ключ v2): сеем активный текстовый фильтр по атрибуту.
    localStorage.setItem(
      'nodus-list-filters-v1:projects.structure',
      JSON.stringify({ filters: { [`cf.${NOTE_ID}`]: 'фасад' }, presets: [] }),
    );
    renderTab();

    expect(screen.getByText('Здание 1')).toBeTruthy();
    // Неподходящий потомок, задачи и «Без папки» фильтром скрыты.
    expect(screen.queryByText('Раздел АР')).toBeNull();
    expect(screen.queryByText('Согласовать АР')).toBeNull();
    expect(screen.queryByText(ui.structure.noNodeSection)).toBeNull();
    expect(screen.queryByText('Задача вне структуры')).toBeNull();
  });

  it('сворачивание ветки прячет потомков со счётчиком', () => {
    world.loading = false;
    world.structure = treeStructure();
    renderTab();

    fireEvent.click(screen.getAllByRole('button', { name: ui.tasks.collapseBranch })[0]!);
    expect(screen.queryByText('Раздел АР')).toBeNull();
    expect(screen.queryByText('Согласовать АР')).toBeNull();
    // Счётчик свернутых: раздел АР и его задача.
    expect(screen.getByText('+2')).toBeTruthy();
  });
});
