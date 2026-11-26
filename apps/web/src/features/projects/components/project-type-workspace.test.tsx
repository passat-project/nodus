// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectType } from '@nodus/contracts';

const state = vi.hoisted(() => ({
  types: [] as ProjectType[],
  captured: {} as Record<string, unknown>,
}));

vi.mock('../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(() => ({ data: [] })),
}));
vi.mock('../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => ({ data: state.types })),
}));
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
vi.mock('../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: vi.fn(() => true),
}));

vi.mock('./project-schema-canvas.js', () => ({
  ProjectSchemaCanvas: (props: { type: ProjectType; onOpenSettings: () => void }) => (
    <div data-testid="canvas" data-type={props.type.name}>
      <button type="button" onClick={props.onOpenSettings}>
        canvas-settings
      </button>
    </div>
  ),
}));
vi.mock('./project-type-settings.js', () => ({
  ProjectTypeSettingsPanel: (props: {
    open: boolean;
    onOpenCreation: () => void;
    onOpenKinds: () => void;
  }) => (
    <div data-testid="settings-panel" data-open={String(props.open)}>
      <button type="button" onClick={props.onOpenCreation}>
        open-creation
      </button>
      <button type="button" onClick={props.onOpenKinds}>
        open-kinds
      </button>
    </div>
  ),
}));
vi.mock('./project-window-panel.js', () => ({
  ProjectWindowPanel: () => <div data-testid="window-panel" />,
}));
vi.mock('./project-type-creation.js', () => ({
  ProjectTypeCreationPage: (props: {
    type: ProjectType;
    onBack: () => void;
    onOpenType: (id: string) => void;
  }) => (
    <div data-testid="creation-page" data-type={props.type.name}>
      <button type="button" onClick={props.onBack}>
        creation-back
      </button>
      <button type="button" onClick={() => props.onOpenType('t9')}>
        creation-open-type
      </button>
    </div>
  ),
}));
vi.mock('./project-type-kinds.js', () => ({
  ProjectTypeKindsPage: (props: {
    type: ProjectType;
    onBack: () => void;
    onOpenKind: (id: string) => void;
  }) => (
    <div data-testid="kinds-page" data-type={props.type.name}>
      <button type="button" onClick={props.onBack}>
        kinds-back
      </button>
      <button type="button" onClick={() => props.onOpenKind('k9')}>
        kinds-open-kind
      </button>
    </div>
  ),
}));

import { ProjectTypeWorkspace } from './project-type-workspace.js';

const TYPE = (id: string, name: string) =>
  ({
    id,
    name,
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
  }) as unknown as ProjectType;

function setup(typeId: string, settingsRequest = 0) {
  state.captured = {};
  render(
    <ProjectTypeWorkspace
      typeId={typeId}
      settingsRequest={settingsRequest}
      onOpenType={(id) => {
        state.captured.openType = id;
      }}
      onOpenKind={(id) => {
        state.captured.openKind = id;
      }}
    />,
  );
}

afterEach(() => {
  cleanup();
  state.types = [];
});

describe('рабочая область типа проекта (#857)', () => {
  it('канвас выбранного типа; чужой id — пустое состояние', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.getByTestId('canvas').dataset.type).toBe('Договор');
    cleanup();
    setup('missing');
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(screen.getByText('Типов пока нет')).toBeTruthy();
  });

  it('«Настройки типа» открываются кнопкой канваса и командой строки (settingsRequest)', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.getByTestId('settings-panel').dataset.open).toBe('false');
    fireEvent.click(screen.getByText('canvas-settings'));
    expect(screen.getByTestId('settings-panel').dataset.open).toBe('true');
    cleanup();
    setup('p1', 1);
    expect(screen.getByTestId('settings-panel').dataset.open).toBe('true');
  });

  it('строки панели открывают страницы; «‹» возвращает к канвасу', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByText('open-creation'));
    expect(screen.getByTestId('creation-page').dataset.type).toBe('Договор');
    expect(screen.queryByTestId('canvas')).toBeNull();
    fireEvent.click(screen.getByText('creation-back'));
    expect(screen.getByTestId('canvas')).toBeTruthy();

    fireEvent.click(screen.getByText('open-kinds'));
    expect(screen.getByTestId('kinds-page')).toBeTruthy();
    fireEvent.click(screen.getByText('kinds-back'));
    expect(screen.getByTestId('canvas')).toBeTruthy();
  });

  it('клик по строкам страниц проходит насквозь: onOpenType/onOpenKind', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByText('open-creation'));
    fireEvent.click(screen.getByText('creation-open-type'));
    expect(state.captured.openType).toBe('t9');
    fireEvent.click(screen.getByText('creation-back'));

    fireEvent.click(screen.getByText('open-kinds'));
    fireEvent.click(screen.getByText('kinds-open-kind'));
    expect(state.captured.openKind).toBe('k9');
  });
});
