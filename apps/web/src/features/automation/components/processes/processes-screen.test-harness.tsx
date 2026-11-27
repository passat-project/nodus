/**
 * Стенд тестов `ProcessesScreen`: моки зависимостей экрана, данные и отрисовка.
 *
 * Импортируется ВЫШЕ модулей, которые тянут замоканные зависимости: моки
 * регистрируются при вычислении стенда, до первого импорта экрана.
 *
 * Vitest поднимает `vi.hoisted` и `vi.mock` над импортами и не даёт
 * экспортировать поднятое — состояние стенда вынесено одним объектом `harness`.
 */
import { render } from '@testing-library/react';
import type { ProcessType } from '@nodus/contracts';
import { vi, type Mock } from 'vitest';

const searchState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const navigateSpy = vi.hoisted(() => vi.fn());
const stackState = vi.hoisted(() => ({ value: [] as { kind: string; id: string }[] }));
const routeDocState = vi.hoisted(() => ({
  value: { selection: null as unknown, dirty: false, workflowId: '' },
}));
const storeApi = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchState.value,
  useNavigate: () => navigateSpy,
}));
vi.mock('../../../../app/shell/use-card-stack.js', () => ({
  useCardStack: () => stackState.value,
}));

vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: vi.fn(() => ({
    data: [...FIXTURES.processTypes, ...FIXTURES.letters],
    isLoading: false,
  })),
}));
/** Живые типы, чьи маршруты экран предзагружает при входе в раздел. */
const prefetchState = vi.hoisted(() => ({ ids: null as string[] | null }));
vi.mock('../../api/routes-prefetch.js', () => ({
  usePrefetchRoutes: (types: readonly { id: string }[]) => {
    prefetchState.ids = types.map((type) => type.id);
  },
}));
vi.mock('../../model/route-doc-store.js', () => ({
  useRouteDocStore: Object.assign(
    (selector: (state: { selection: unknown; dirty: boolean; workflowId: string }) => unknown) =>
      selector(routeDocState.value),
    { getState: () => ({ select: storeApi.select }) },
  ),
}));

vi.mock('../../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(() => ({ data: FIXTURES.kinds })),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => ({ data: FIXTURES.projectTypes })),
}));
vi.mock('../../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
/** Ответ запроса маршрута. По умолчанию — документ запрошенного маршрута; тест
 *  подменяет его, чтобы смоделировать «новый маршрут ещё грузится». */
const workflowState = vi.hoisted(() => ({
  reply: null as null | ((id: string | null) => unknown),
}));
vi.mock('../../../../shared/workflow/workflow-api.js', () => ({
  useWorkflowDetail: vi.fn((id: string | null) => workflowState.reply!(id)),
}));
const cardProps = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('./process-type-card.js', () => ({
  ProcessTypeCard: (props: {
    type: ProcessType;
    suspended?: boolean;
    renderProjectTypeCreate?: unknown;
  }) => {
    cardProps.value = props;
    return (
      <div
        data-testid="process-type-card"
        data-type={props.type.name}
        data-suspended={props.suspended ? 'yes' : 'no'}
      />
    );
  },
}));
vi.mock('./without-project-page.js', () => ({
  WithoutProjectPage: () => <div data-testid="without-project" />,
}));
const listProps = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('./unified-type-list.js', () => ({
  UnifiedTypeList: (props: Record<string, unknown>) => {
    listProps.value = props;
    return <div data-testid="unified-list" data-props={JSON.stringify(Object.keys(props))} />;
  },
}));

const FIXTURES = vi.hoisted(() => ({
  processTypes: [
    {
      id: 't1',
      name: 'Задание смежнику',
      category: 'task',
      archivedAt: null,
      workflowId: 'wf-1',
      isSystem: false,
      creatable: true,
      config: {
        creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
      },
    },
    {
      id: 't2',
      name: 'Смета',
      category: 'task',
      archivedAt: null,
      workflowId: 'wf-2',
      isSystem: false,
      creatable: true,
      config: {
        creation: { excludedProjectTypeIds: ['p1'], folderKindId: null, withoutProject: false },
      },
    },
  ],
  letters: [
    {
      id: 'l1',
      name: 'Письмо заказчику',
      category: 'letter',
      archivedAt: null,
      workflowId: 'wf-3',
      isSystem: false,
      creatable: true,
      config: {
        creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: false },
      },
    },
  ],
  projectTypes: [
    { id: 'p1', name: 'Договор', icon: 'file-text', archivedAt: null },
    { id: 'p2', name: 'Тема', icon: 'flag', archivedAt: null },
  ],
  kinds: [
    { id: 'k1', name: 'Комплект', icon: 'folder', color: 'blue', archivedAt: null },
    { id: 'k2', name: 'Чертёж', icon: 'drafting-compass', color: 'violet', archivedAt: null },
  ],
}));

/** Изменяемое состояние стенда: адрес, стек карточек, стор редактора, ответы
 *  запросов и пропсы замоканных рамы/колонки последней отрисовки. Тип записан
 *  явно: выведенный тянет типы моков по внутренним путям пакетов. */
export const harness: {
  FIXTURES: typeof FIXTURES;
  cardProps: { value: Record<string, unknown> | null };
  listProps: { value: Record<string, unknown> | null };
  navigateSpy: Mock;
  prefetchState: { ids: string[] | null };
  routeDocState: { value: { selection: unknown; dirty: boolean; workflowId: string } };
  searchState: { value: Record<string, unknown> };
  stackState: { value: { kind: string; id: string }[] };
  storeApi: { select: Mock };
  workflowState: { reply: null | ((id: string | null) => unknown) };
} = {
  FIXTURES,
  cardProps,
  listProps,
  navigateSpy,
  prefetchState,
  routeDocState,
  searchState,
  stackState,
  storeApi,
  workflowState,
};

// Импорты — после регистрации моков: экран и его зависимости разбираются
// уже заменёнными (при подъёме `vi.mock` порядок тот же).
import { ProcessesScreen } from './processes-screen.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';

export const screenElement = () => (
  <ProcessesScreen
    onArchiveProject={vi.fn()}
    onArchiveNodeKind={vi.fn()}
    renderProjectWorkspace={(slot) => (
      <div data-testid="workspace-slot" data-type-id={slot.typeId} />
    )}
    renderFolderCard={(slot) => <div data-testid="folder-slot" data-kind-id={slot.kindId} />}
    renderProjectTypeCreate={vi.fn(() => null)}
    renderProcessTypeCreate={vi.fn(() => null)}
    renderKindCreate={vi.fn(() => null)}
  />
);

export function setup(search: Record<string, unknown>): ReturnType<typeof render> {
  searchState.value = search;
  navigateSpy.mockClear();
  listProps.value = null;
  cardProps.value = null;
  return render(screenElement());
}

/** Маршрут запрошенного типа на руках. */
export const workflowLoaded = (id: string | null) => ({
  data: id ? { id, document: { stages: [] } } : undefined,
});

/** Применить апдейтер последнего navigate к поисковым параметрам. */
export function searchOf(): Record<string, string | undefined> {
  return navigateSpy.mock.calls.at(-1)![0].search({
    tab: 'processes',
    type: 't1',
    ptype: 'p1',
    noproject: '1',
  });
}

/** Исходное состояние стенда — в `beforeEach` каждого файла тестов. */
export function resetScreen() {
  workflowState.reply = workflowLoaded;
  stackState.value = [];
  routeDocState.value = { selection: null, dirty: false, workflowId: '' };
  useTypeSettingsStore.setState({ target: null });
}
