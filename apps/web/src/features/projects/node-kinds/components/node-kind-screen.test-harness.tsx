/**
 * Стенд тестов `NodeKindScreen` (карточка типа папки): моки зависимостей
 * экрана, фикстуры и отрисовка.
 *
 * Импортируется ВЫШЕ модулей, которые тянут замоканные зависимости: моки
 * регистрируются при вычислении стенда, до первого импорта экрана.
 *
 * Vitest поднимает `vi.hoisted` и `vi.mock` над импортами и не даёт
 * экспортировать поднятое — состояние стенда вынесено одним объектом `harness`.
 */
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig } from '@nodus/contracts';
import { vi, type Mock } from 'vitest';

vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));
// projectsKeys нужны транзитивным импортам мутаций каталога (не только хук).
vi.mock('../../../../shared/api/projects-list.js', () => ({
  projectsKeys: { all: ['projects'], list: ['projects', 'list'] },
  useProjectTypes: vi.fn(),
}));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(),
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: vi.fn(() => true),
}));
vi.mock('../../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
const api = vi.hoisted(() => ({ update: vi.fn(), archive: vi.fn() }));
// Стек карточек: строки вкладок кладут карточку ПОВЕРХ, рама не переезжает.
const openCardSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => openCardSpy,
}));
vi.mock('../api/node-kinds-api.js', () => ({
  useUpdateNodeKind: vi.fn(() => ({ mutate: api.update })),
  useArchiveNodeKind: vi.fn(() => ({ mutate: api.archive })),
}));
/** Автосохранение формы — здесь только рама: состояние линии бара и вызовы. */
const autosave = vi.hoisted(() => ({
  state: 'idle' as string,
  edit: vi.fn(),
  retry: vi.fn(),
  flush: vi.fn(),
}));
vi.mock('./node-kind-form-tab.js', () => ({
  useNodeKindForm: () => autosave,
  NodeKindFormTab: (props: Record<string, unknown>) => (
    <div
      data-testid="kind-form-tab"
      data-can-setup={props.canSetup ? 'yes' : 'no'}
      data-create-field-slot={props.renderCreateField ? 'yes' : 'no'}
    />
  ),
}));

// Журнальные списки вкладок меряют края скролла ResizeObserver-ом.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/** Изменяемое состояние стенда: замоканные мутации типа папки, стек карточек
 *  и линия автосохранения. Тип записан явно: выведенный тянет типы моков по
 *  внутренним путям пакетов. */
export const harness: {
  api: { update: Mock; archive: Mock };
  autosave: { state: string; edit: Mock; retry: Mock; flush: Mock };
  openCardSpy: Mock;
} = { api, autosave, openCardSpy };

// Импорты — после регистрации моков: экран и его зависимости разбираются
// уже заменёнными (при подъёме `vi.mock` порядок тот же).
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { NodeKindScreen } from './node-kind-screen.js';

export const KIND_ID = '70000000-0000-4000-8000-000000000001';

export const KIND = {
  id: KIND_ID,
  name: 'Комплект',
  icon: 'folder',
  color: 'blue',
  archivedAt: null,
  form: { fields: [] },
  capabilities: [],
} as unknown as NodeKind;

export const TASK = (id: string, folderKindId: string | null): ProcessType =>
  ({
    id,
    code: id,
    name: 'Задание смежнику',
    category: 'task',
    direction: null,
    icon: 'square-check',
    color: 'neutral',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: `wf-${id}`,
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [], folderKindId, withoutProject: true },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
  }) as unknown as ProcessType;

export const PROJECT = (id: string, kindIds: string[] | null, name = 'Договор') =>
  ({
    id,
    name,
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds,
    archivedAt: null,
  }) as unknown as ProjectType;

/** Исходное состояние стенда — в `beforeEach` каждого файла тестов. */
export function resetScreen() {
  autosave.state = 'idle';
  useTypeSettingsStore.setState({ target: null });
}

/** Результат `setup`: замоканная мутация привязки, запрос на закрытие экрана,
 *  отрисовка (для `rerender`) и пропсы экрана. Тип записан явно: выведенный
 *  тянет внутренние пути пакетов тестовой среды. */
interface SetupResult {
  mutate: Mock;
  onMissing: Mock;
  view: ReturnType<typeof render>;
  props: { kindId: string; onMissing: Mock };
}

export function setup(
  patch: { tasks?: ProcessType[]; projects?: ProjectType[]; kinds?: NodeKind[] } = {},
): SetupResult {
  const mutate = vi.fn();
  const onMissing = vi.fn();
  api.update.mockClear();
  api.archive.mockClear();
  openCardSpy.mockClear();
  useTypeSettingsStore.setState({ target: null });
  vi.mocked(useNodeKinds).mockReturnValue({
    data: patch.kinds ?? [KIND],
    isLoading: false,
  } as never);
  vi.mocked(useProjectTypes).mockReturnValue({
    data: patch.projects ?? [PROJECT('p1', null)],
  } as never);
  vi.mocked(useLiveProcessTypes).mockReturnValue({
    data: patch.tasks ?? [TASK('t1', null)],
  } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  const props = { kindId: KIND_ID, onMissing };
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <NodeKindScreen {...props} />
    </QueryClientProvider>,
  );
  return { mutate, onMissing, view, props };
}
