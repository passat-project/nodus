// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
}));

const processState = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false }));
const projectState = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false }));
const kindState = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false }));

vi.mock('../features/automation/api/automation-api.js', () => ({
  useProcessTypes: vi.fn(() => processState),
}));
vi.mock('../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => projectState),
}));
vi.mock('../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(() => kindState),
}));
vi.mock('../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
vi.mock('../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: vi.fn(() => ({ data: [] })),
}));
vi.mock('../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: vi.fn(() => true),
}));
vi.mock('../features/automation/components/fields/field-dialog.js', () => ({
  FieldDialog: () => <div data-testid="field-dialog" />,
}));

const ID = {
  process: '10000000-0000-4000-8000-000000000001',
  project: '10000000-0000-4000-8000-000000000002',
  kind: '10000000-0000-4000-8000-000000000003',
  task: '10000000-0000-4000-8000-000000000009',
};
const dialogs = vi.hoisted(() => ({
  process: null as null | { onArchived?: () => void },
  project: null as null | { onArchived?: () => void },
  kind: null as null | { onArchived?: () => void },
}));
vi.mock('../features/automation/components/processes/process-type-settings-dialog.js', () => ({
  ProcessTypeSettingsDialog: (props: { type: { id: string }; onArchived?: () => void }) => {
    dialogs.process = props;
    return <div data-testid="process-settings" data-id={props.type.id} />;
  },
}));
vi.mock('../features/projects/components/project-type-settings-dialog.js', () => ({
  ProjectTypeSettingsDialog: (props: {
    type: { id: string };
    canSetup: boolean;
    onArchived?: () => void;
  }) => {
    dialogs.project = props;
    return (
      <div
        data-testid="project-settings"
        data-id={props.type.id}
        data-can={props.canSetup ? 'yes' : 'no'}
      />
    );
  },
}));
vi.mock('../features/projects/node-kinds/components/node-kind-settings-dialog.js', () => ({
  NodeKindSettingsDialog: (props: { kind: { id: string }; onArchived?: () => void }) => {
    dialogs.kind = props;
    return <div data-testid="kind-settings" data-id={props.kind.id} />;
  },
}));
vi.mock('../features/projects/components/project-type-create-dialog.js', () => ({
  ProjectTypeCreateDialog: () => <div data-testid="project-create" />,
}));
vi.mock('../features/projects/node-kinds/components/node-kind-create-dialog.js', () => ({
  NodeKindCreateDialog: () => <div data-testid="kind-create" />,
}));
vi.mock('../features/automation/components/types/type-create-dialog.js', () => ({
  ProcessTypeCreateDialog: () => <div data-testid="process-create" />,
}));
vi.mock('../features/projects/components/project-type-workspace.js', () => ({
  ProjectTypeWorkspace: (props: {
    typeId: string;
    renderProcessTypeCreate?: unknown;
    renderCreateField?: unknown;
  }) => (
    <div
      data-testid="workspace"
      data-id={props.typeId}
      data-slots={props.renderProcessTypeCreate ? 'yes' : 'no'}
      data-field-slot={props.renderCreateField ? 'yes' : 'no'}
    />
  ),
}));
vi.mock('../features/projects/node-kinds/components/node-kind-screen.js', () => ({
  NodeKindScreen: (props: { kindId: string; renderCreateField?: unknown }) => (
    <div
      data-testid="kind-screen"
      data-id={props.kindId}
      data-field-slot={props.renderCreateField ? 'yes' : 'no'}
    />
  ),
}));

import {
  ProjectTypeWorkspaceHost,
  NodeKindScreenHost,
  TypeSettingsHost,
  renderKindCreate,
  renderProcessTypeCreate,
  renderProjectTypeCreate,
} from './automation-hosts.js';
import { useTypeSettingsStore } from '../shared/ui/type-settings-store.js';

const PROCESS = { id: ID.process, name: 'Комплект' } as ProcessType;
const PROJECT = { id: ID.project, name: 'Договор' } as ProjectType;
const KIND = { id: ID.kind, name: 'Комплект' } as NodeKind;

beforeEach(() => {
  navigateSpy.mockClear();
  dialogs.process = null;
  dialogs.project = null;
  dialogs.kind = null;
  processState.data = [PROCESS];
  projectState.data = [PROJECT];
  kindState.data = [KIND];
  useTypeSettingsStore.setState({ target: null });
});

afterEach(cleanup);

describe('TypeSettingsHost — резидентное окно настроек типа (#857, ревизия UI v3)', () => {
  it('окна нет, пока его не попросили', () => {
    render(<TypeSettingsHost />);
    expect(screen.queryByTestId('process-settings')).toBeNull();
    expect(screen.queryByTestId('project-settings')).toBeNull();
    expect(screen.queryByTestId('kind-settings')).toBeNull();
  });

  it('target → одно из трёх окон по виду; сущность берётся из списка своего вида', () => {
    const { unmount } = render(<TypeSettingsHost />);
    act(() =>
      useTypeSettingsStore.getState().openSettings({ kind: 'process-type', id: ID.process }),
    );
    expect(screen.getByTestId('process-settings').dataset.id).toBe(ID.process);
    act(() =>
      useTypeSettingsStore.getState().openSettings({ kind: 'project-type', id: ID.project }),
    );
    expect(screen.getByTestId('project-settings').dataset.id).toBe(ID.project);
    expect(screen.getByTestId('project-settings').dataset.can).toBe('yes');
    expect(screen.queryByTestId('process-settings')).toBeNull();
    act(() => useTypeSettingsStore.getState().openSettings({ kind: 'node-kind', id: ID.kind }));
    expect(screen.getByTestId('kind-settings').dataset.id).toBe(ID.kind);
    unmount();
  });

  it('архив из окна: окно закрывается, карточка этой сущности уходит из стека', () => {
    render(<TypeSettingsHost />);
    act(() =>
      useTypeSettingsStore.getState().openSettings({ kind: 'process-type', id: ID.process }),
    );
    act(() => dialogs.process!.onArchived!());
    expect(useTypeSettingsStore.getState().target).toBeNull();
    // Стек: [задача, этот тип, проект] → карточка типа снята, остальные живы.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const call = navigateSpy.mock.calls[0]![0];
    expect(call.replace).toBe(true);
    expect(
      call.search({
        tab: 'processes',
        cards: `task:${ID.task},process-type:${ID.process},project-type:${ID.project}`,
      }),
    ).toEqual({
      tab: 'processes',
      cards: `task:${ID.task},project-type:${ID.project}`,
    });
  });

  it('сущность окна пропала — пустого окна не держим', () => {
    render(<TypeSettingsHost />);
    act(() =>
      useTypeSettingsStore
        .getState()
        .openSettings({ kind: 'project-type', id: '20000000-0000-4000-8000-000000000001' }),
    );
    expect(screen.queryByTestId('project-settings')).toBeNull();
    expect(useTypeSettingsStore.getState().target).toBeNull();
  });

  it('окна-конструктора формы в хосте больше нет: форма настраивается вкладкой рамы (единая модель, #857)', () => {
    render(<TypeSettingsHost />);
    act(() =>
      useTypeSettingsStore.getState().openSettings({ kind: 'project-type', id: ID.project }),
    );
    // Хост держит только три окна настроек — ни диалога редактора, ни цели для него в сторе.
    expect(screen.getAllByTestId(/-settings$/)).toHaveLength(1);
    expect(Object.keys(useTypeSettingsStore.getState()).sort()).toEqual([
      'closeSettings',
      'openSettings',
      'target',
    ]);
  });

  it('окно открывается ВНЕ раздела «Автоматизация»: хосту не нужен контекст маршрута', () => {
    // Так его монтирует app-shell (стек карточек живёт поверх любого
    // раздела, ADR-0009): без AutomationRoute, без его провайдеров.
    render(<TypeSettingsHost />);
    act(() =>
      useTypeSettingsStore.getState().openSettings({ kind: 'process-type', id: ID.process }),
    );
    expect(screen.getByTestId('process-settings').dataset.id).toBe(ID.process);
  });
});

describe('контракт монтажа окна настроек: шелл, а не маршрут раздела (#857)', () => {
  // Карточки типов живут в стеке `?cards=` поверх любого раздела и переживают
  // смену раздела (ADR-0009) — их шестерёнка обязана работать и вне
  // «Автоматизации». Хост монтирует app-shell; возврат в маршрут раздела
  // молча ломает настройки в чужих разделах (ревью #857, 27.11) — держим
  // состав монтажа тестом, а не памятью исполнителя.
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
      // Комментарии вправе упоминать хост (документация) — контракт о коде.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('TypeSettingsHost рендерит app-shell.tsx и НЕ рендерит automation-route.tsx', () => {
    expect(read('./shell/app-shell.tsx')).toMatch(/<TypeSettingsHost\s*\/>/);
    expect(read('./automation-route.tsx')).not.toMatch(/TypeSettingsHost/);
  });
});

describe('хосты тел карточек и рамы — одни слоты (#857)', () => {
  it('ProjectTypeWorkspaceHost: typeId, слот создания типа задачи и слот «Создать атрибут»', () => {
    render(<ProjectTypeWorkspaceHost id={ID.project} />);
    const workspace = screen.getByTestId('workspace');
    expect(workspace.dataset.id).toBe(ID.project);
    // Окна — код фичи automation: хост подставляет их фиче projects (I6).
    expect(workspace.dataset.slots).toBe('yes');
    expect(workspace.dataset.fieldSlot).toBe('yes');
  });

  it('NodeKindScreenHost: id, onMissing и слот «Создать атрибут»', () => {
    const onMissing = vi.fn();
    render(<NodeKindScreenHost id={ID.kind} onMissing={onMissing} />);
    const kindScreen = screen.getByTestId('kind-screen');
    expect(kindScreen.dataset.id).toBe(ID.kind);
    expect(kindScreen.dataset.fieldSlot).toBe('yes');
  });

  it('слоты окон создания несут основу-копию', () => {
    const slot = { baseId: 'base-1', onClose: vi.fn(), onCreated: vi.fn() };
    const { unmount } = render(<>{renderProjectTypeCreate(slot)}</>);
    expect(screen.getByTestId('project-create')).toBeTruthy();
    unmount();
    const second = render(<>{renderKindCreate(slot)}</>);
    expect(screen.getByTestId('kind-create')).toBeTruthy();
    second.unmount();
    render(<>{renderProcessTypeCreate(slot)}</>);
    expect(screen.getByTestId('process-create')).toBeTruthy();
  });
});
