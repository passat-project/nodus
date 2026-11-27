// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const searchState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchState.value,
  useNavigate: () => navigateSpy,
}));

const kinds = vi.hoisted(() => [
  { id: 'k1', name: 'Комплект', icon: 'folder', color: 'blue', archivedAt: null },
]);
const projectTypes = vi.hoisted(() => [
  { id: 'p1', name: 'Договор', icon: 'file-text', color: 'blue', archivedAt: null },
]);

vi.mock('../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(() => ({ data: kinds, isLoading: false })),
}));
vi.mock('../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => ({ data: projectTypes, isLoading: false })),
}));
vi.mock('../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
vi.mock('../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: vi.fn(() => ({ data: [] })),
}));
vi.mock('../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: vi.fn(() => false),
}));
vi.mock('../features/automation/api/automation-api.js', () => ({
  useProcessTypes: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock('../features/projects/node-kinds/api/node-kinds-api.js', () => ({
  useArchiveNodeKind: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('../features/projects/api/project-catalog-mutations.js', () => ({
  useSetProjectTypeArchived: vi.fn(() => ({ mutate: vi.fn() })),
}));

/** Последние пропсы карточки типа папки: проверяем связку слотов (I6). */
const kindScreenProps = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));
vi.mock('../features/projects/node-kinds/components/node-kind-screen.js', () => ({
  NodeKindScreen: (props: { kindId: string }) => {
    kindScreenProps.value = props;
    return <div data-testid="kind-screen" data-kind={props.kindId} />;
  },
}));
const workspaceProps = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));
vi.mock('../features/projects/components/project-type-workspace.js', () => ({
  ProjectTypeWorkspace: (props: { typeId: string }) => {
    workspaceProps.value = props;
    return <div data-testid="workspace" data-type={props.typeId} />;
  },
}));
vi.mock('../features/projects/components/project-type-create-dialog.js', () => ({
  ProjectTypeCreateDialog: (props: { defaultBaseTypeId?: string }) => (
    <div data-testid="project-create-dialog" data-base={props.defaultBaseTypeId ?? ''} />
  ),
}));
vi.mock('../features/projects/node-kinds/components/node-kind-create-dialog.js', () => ({
  NodeKindCreateDialog: (props: { defaultBaseKindId?: string }) => (
    <div data-testid="kind-create-dialog" data-base={props.defaultBaseKindId ?? ''} />
  ),
}));
vi.mock('../features/automation/components/types/type-create-dialog.js', () => ({
  ProcessTypeCreateDialog: (props: { defaultBaseTypeId?: string }) => (
    <div data-testid="process-create-dialog" data-base={props.defaultBaseTypeId ?? ''} />
  ),
}));
/** Хост окна настроек монтирует app-shell (карточки типов живут в стеке
 *  поверх любого раздела): мок с testid остаётся как детектор — если маршрут
 *  снова начнёт рендерить хост, проверка ниже его поймает. */
vi.mock('./automation-hosts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./automation-hosts.js')>();
  return {
    ...actual,
    TypeSettingsHost: () => <div data-testid="type-settings-host" />,
  };
});

/** AutomationPage-шпион: экспонирует полученные слоты для проверки связки. */
const pageSlots = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('../features/automation/pages/automation-page.js', () => ({
  AutomationPage: (props: Record<string, unknown>) => {
    pageSlots.value = props;
    return <div data-testid="automation-page" />;
  },
}));
/** Тела карточек типов — ленивый кусок: разделу достаточно его предзагрузить. */
const preloadSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./shell/card-type-entry.js', () => ({ preloadTypeCardEntries: preloadSpy }));

import { AutomationRoute } from './automation-route.js';

function setup(search: Record<string, unknown>) {
  searchState.value = search;
  navigateSpy.mockClear();
  preloadSpy.mockClear();
  pageSlots.value = null;
  kindScreenProps.value = null;
  workspaceProps.value = null;
  render(<AutomationRoute />);
}

type Slot<T> = (slot: T) => ReactNode;
type CreateSlot = { baseId?: string; onClose: () => void; onCreated: (id: string) => void };

afterEach(cleanup);

describe('композиция раздела «Автоматизация» (#857, ревизия UI v3, I6)', () => {
  it('рама смонтирована; хост окна настроек маршрутом НЕ рендерится — он в шелле', () => {
    setup({ tab: 'processes', ptype: 'p1', ftype: 'k1' });
    expect(screen.getByTestId('automation-page')).toBeTruthy();
    expect(screen.queryByTestId('type-settings-host')).toBeNull();
  });

  it('вход в раздел предзагружает ленивые тела карточек типов — клик по строке их не ждёт', () => {
    setup({ tab: 'processes', ptype: 'p1' });
    expect(preloadSpy).toHaveBeenCalledTimes(1);
  });

  it('слот карточки типа папки рендерит NodeKindScreen с kindId', () => {
    setup({ tab: 'processes', ptype: 'p1', ftype: 'k1' });
    const slot = pageSlots.value!.renderFolderCard as Slot<{ kindId: string }>;
    cleanup();
    render(slot({ kindId: 'k1' }) as React.ReactElement);
    expect(screen.getByTestId('kind-screen').dataset.kind).toBe('k1');
  });

  it('карточка типа папки: сущность пропала — рама уходит на поверхность по умолчанию (без ключей поверхности)', () => {
    setup({ tab: 'processes', ptype: 'p1', ftype: 'k1' });
    const slot = pageSlots.value!.renderFolderCard as Slot<{ kindId: string }>;
    cleanup();
    render(slot({ kindId: 'k1' }) as React.ReactElement);
    const props = kindScreenProps.value!;
    (props.onMissing as () => void)();
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/automation', search: expect.any(Function) }),
    );
    const updater = navigateSpy.mock.calls[0]![0].search;
    // Поверхность по умолчанию, а не «ftype убрать, остальное оставить»: в адресе
    // после выбора папки других ключей поверхности и не должно быть.
    expect(updater({ tab: 'processes', ptype: 'p1', ftype: 'k1', cards: 'task:x' })).toEqual({
      tab: 'processes',
      cards: 'task:x',
    });
  });

  it('слот рабочей области рендерит ProjectTypeWorkspace с typeId и слотом фичи automation', () => {
    setup({ tab: 'processes', ptype: 'p1' });
    const slot = pageSlots.value!.renderProjectWorkspace as Slot<{ typeId: string }>;
    cleanup();
    render(slot({ typeId: 'p2' }) as React.ReactElement);
    expect(screen.getByTestId('workspace').dataset.type).toBe('p2');
    // Окно создания типа задачи — код фичи automation: хост уровня app
    // подставляет его фиче projects (I6).
    const props = workspaceProps.value!;
    expect(typeof props.renderProcessTypeCreate).toBe('function');
  });

  it('слоты окон создания несут основу-копию', () => {
    setup({ tab: 'processes' });
    const slots = pageSlots.value!;
    cleanup();
    render(
      (slots.renderProjectTypeCreate as Slot<CreateSlot>)({
        baseId: 'p1',
        onClose: vi.fn(),
        onCreated: vi.fn(),
      }) as React.ReactElement,
    );
    expect(screen.getByTestId('project-create-dialog').dataset.base).toBe('p1');
    cleanup();
    render(
      (slots.renderKindCreate as Slot<CreateSlot>)({
        baseId: 'k1',
        onClose: vi.fn(),
        onCreated: vi.fn(),
      }) as React.ReactElement,
    );
    expect(screen.getByTestId('kind-create-dialog').dataset.base).toBe('k1');
    cleanup();
    render(
      (slots.renderProcessTypeCreate as Slot<CreateSlot>)({
        baseId: 't1',
        onClose: vi.fn(),
        onCreated: vi.fn(),
      }) as React.ReactElement,
    );
    expect(screen.getByTestId('process-create-dialog').dataset.base).toBe('t1');
  });
});
