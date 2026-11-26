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
  useProjectTypes: vi.fn(() => ({ data: projectTypes })),
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
vi.mock('../features/projects/node-kinds/api/node-kinds-api.js', () => ({
  useArchiveNodeKind: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('../features/projects/api/project-catalog-mutations.js', () => ({
  useSetProjectTypeArchived: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('../features/projects/node-kinds/components/node-kind-screen.js', () => ({
  NodeKindScreen: (props: { kindId: string; backLabel: string }) => (
    <div data-testid="kind-screen" data-kind={props.kindId} data-back={props.backLabel} />
  ),
}));
vi.mock('../features/projects/components/project-type-workspace.js', () => ({
  ProjectTypeWorkspace: (props: { typeId: string; settingsRequest: number }) => (
    <div
      data-testid="workspace"
      data-type={props.typeId}
      data-request={String(props.settingsRequest)}
    />
  ),
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

/** AutomationPage-шпион: экспонирует полученные слоты для проверки связки. */
const pageSlots = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('../features/automation/pages/automation-page.js', () => ({
  AutomationPage: (props: Record<string, unknown>) => {
    pageSlots.value = props;
    return <div data-testid="automation-page" />;
  },
}));

import { AutomationRoute } from './automation-route.js';

function setup(search: Record<string, unknown>) {
  searchState.value = search;
  navigateSpy.mockClear();
  pageSlots.value = null;
  render(<AutomationRoute />);
}

afterEach(cleanup);

describe('композиция раздела «Автоматизация» (#857, I6)', () => {
  it('?ftype= — экран типа папки на всю область, дорожка из ptype в возврате', () => {
    setup({ tab: 'processes', ptype: 'p1', ftype: 'k1' });
    const screenEl = screen.getByTestId('kind-screen');
    expect(screenEl.dataset.kind).toBe('k1');
    expect(screenEl.dataset.back).toBe('Договор');
    expect(screen.queryByTestId('automation-page')).toBeNull();
  });

  it('?ftype= без ptype — возврат «Назад»', () => {
    setup({ tab: 'processes', ftype: 'k1' });
    expect(screen.getByTestId('kind-screen').dataset.back).toBe('Назад');
  });

  it('чужой ftype при загруженном справочнике — откат: navigate снимает ftype', () => {
    setup({ tab: 'processes', ftype: 'missing' });
    expect(screen.queryByTestId('kind-screen')).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/automation', search: expect.any(Function) }),
    );
    const updater = navigateSpy.mock.calls[0]![0].search;
    expect(updater({ tab: 'processes', ftype: 'missing' })).toEqual({
      tab: 'processes',
      ftype: undefined,
    });
  });

  it('tab=fields с ftype — вкладка «Атрибуты», экран типа папки не перехватывает', () => {
    setup({ tab: 'fields', ftype: 'k1' });
    expect(screen.getByTestId('automation-page')).toBeTruthy();
    expect(screen.queryByTestId('kind-screen')).toBeNull();
  });

  it('слот рабочей области рендерит ProjectTypeWorkspace с typeId', () => {
    setup({ tab: 'processes', ptype: 'p1' });
    expect(screen.getByTestId('automation-page')).toBeTruthy();
    const slot = pageSlots.value!.renderProjectWorkspace as (slot: {
      typeId: string;
      settingsRequest: number;
      onOpenType: (id: string) => void;
      onOpenKind: (id: string) => void;
      renderCreateField?: (slot2: unknown) => ReactNode;
    }) => ReactNode;
    const node = slot({
      typeId: 'p2',
      settingsRequest: 3,
      onOpenType: vi.fn(),
      onOpenKind: vi.fn(),
      renderCreateField: undefined,
    });
    const host = document.createElement('div');
    document.body.append(host);
    // Слот — JSX; проверяем через вспомогательный рендер.
    cleanup();
    render(node as React.ReactElement);
    const workspace = screen.getByTestId('workspace');
    expect(workspace.dataset.type).toBe('p2');
    expect(workspace.dataset.request).toBe('3');
  });

  it('слоты окон создания несут основу-копию', () => {
    setup({ tab: 'processes' });
    const typeCreate = pageSlots.value!.renderProjectTypeCreate as (slot: {
      baseId?: string;
      onClose: () => void;
      onCreated: (id: string) => void;
    }) => ReactNode;
    const kindCreate = pageSlots.value!.renderKindCreate as (slot: {
      baseId?: string;
      onClose: () => void;
      onCreated: (id: string) => void;
    }) => ReactNode;
    cleanup();
    render(
      typeCreate({ baseId: 'p1', onClose: vi.fn(), onCreated: vi.fn() }) as React.ReactElement,
    );
    expect(screen.getByTestId('project-create-dialog').dataset.base).toBe('p1');
    cleanup();
    render(
      kindCreate({ baseId: 'k1', onClose: vi.fn(), onCreated: vi.fn() }) as React.ReactElement,
    );
    expect(screen.getByTestId('kind-create-dialog').dataset.base).toBe('k1');
  });
});
