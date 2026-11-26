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
// projectsKeys нужны транзитивным импортам мутаций каталога (не только хук).
vi.mock('../../../shared/api/projects-list.js', () => ({
  projectsKeys: { all: ['projects'], list: ['projects', 'list'] },
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
  ProjectSchemaCanvas: (props: { type: ProjectType; onOpenWindow: () => void }) => (
    <div data-testid="canvas" data-type={props.type.name}>
      <button type="button" onClick={props.onOpenWindow}>
        canvas-window
      </button>
    </div>
  ),
}));
vi.mock('./project-type-creation.js', () => ({
  ProjectTypeCreationTab: (props: {
    type: ProjectType;
    onOpenType: (id: string) => void;
    renderProcessTypeCreate?: unknown;
  }) => (
    <div
      data-testid="creation-tab"
      data-type={props.type.name}
      data-create-slot={props.renderProcessTypeCreate ? 'yes' : 'no'}
    >
      <button type="button" onClick={() => props.onOpenType('t9')}>
        creation-open-type
      </button>
    </div>
  ),
}));
vi.mock('./project-type-kinds.js', () => ({
  ProjectTypeKindsTab: (props: { type: ProjectType; onOpenKind: (id: string) => void }) => (
    <div data-testid="kinds-tab" data-type={props.type.name}>
      <button type="button" onClick={() => props.onOpenKind('k9')}>
        kinds-open-kind
      </button>
    </div>
  ),
}));
vi.mock('./project-type-settings-dialog.js', () => ({
  ProjectTypeSettingsDialog: (props: {
    type: ProjectType;
    onEditWindow: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="settings-dialog" data-type={props.type.name}>
      <button type="button" onClick={props.onEditWindow}>
        settings-edit-window
      </button>
      <button type="button" onClick={props.onClose}>
        settings-close
      </button>
    </div>
  ),
}));
vi.mock('./project-window-builder.js', () => ({
  ProjectWindowBuilder: (props: { open: boolean; onClose: () => void }) => (
    <div data-testid="window-builder" data-open={String(props.open)}>
      <button type="button" onClick={props.onClose}>
        builder-close
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
      renderProcessTypeCreate={() => <div data-testid="create-type-slot" />}
    />,
  );
}

afterEach(() => {
  cleanup();
  state.types = [];
});

describe('рабочая область типа проекта — рама с вкладками (#857)', () => {
  it('первая вкладка — холст выбранного типа; чужой id — пустое состояние', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.getByTestId('canvas').dataset.type).toBe('Договор');
    expect(screen.getByRole('tab', { name: 'Схема' }).getAttribute('aria-selected')).toBe('true');
    cleanup();
    setup('missing');
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(screen.getByText('Типов пока нет')).toBeTruthy();
  });

  it('вкладки рамы переключают содержание: холст → создание → папки', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByRole('tab', { name: 'Что здесь можно создавать' }));
    expect(screen.getByTestId('creation-tab').dataset.type).toBe('Договор');
    expect(screen.queryByTestId('canvas')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Какие папки здесь бывают' }));
    expect(screen.getByTestId('kinds-tab').dataset.type).toBe('Договор');
    // Слот создания типа задачи дошёл до вкладки создания (I6).
    fireEvent.click(screen.getByRole('tab', { name: 'Что здесь можно создавать' }));
    expect(screen.getByTestId('creation-tab').dataset.createSlot).toBe('yes');
    // Обратно к холсту — та же рама, без потери выбора.
    fireEvent.click(screen.getByRole('tab', { name: 'Схема' }));
    expect(screen.getByTestId('canvas').dataset.type).toBe('Договор');
  });

  it('клики строк вкладок проходят насквозь: onOpenType/onOpenKind', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByRole('tab', { name: 'Что здесь можно создавать' }));
    fireEvent.click(screen.getByText('creation-open-type'));
    expect(state.captured.openType).toBe('t9');
    fireEvent.click(screen.getByRole('tab', { name: 'Какие папки здесь бывают' }));
    fireEvent.click(screen.getByText('kinds-open-kind'));
    expect(state.captured.openKind).toBe('k9');
  });

  it('окно настроек: шестерёнка рамы и команда строки (settingsRequest)', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Настройки типа' }));
    expect(screen.getByTestId('settings-dialog').dataset.type).toBe('Договор');
    fireEvent.click(screen.getByText('settings-close'));
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    // «⋯ → Настройки типа…» строки колонки: счётчик открывает окно выбранного.
    cleanup();
    setup('p1', 1);
    expect(screen.getByTestId('settings-dialog').dataset.type).toBe('Договор');
  });

  it('окно создания проекта: шестерёнка вкладки «Схема» и канвас', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.getByTestId('window-builder').dataset.open).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Окно создания проекта' }));
    expect(screen.getByTestId('window-builder').dataset.open).toBe('true');
    fireEvent.click(screen.getByText('canvas-window'));
    expect(screen.getByTestId('window-builder').dataset.open).toBe('true');
    // Окно создания закрывается своим onClose (поле рамы не переключается).
    fireEvent.click(screen.getByText('builder-close'));
    expect(screen.getByTestId('window-builder').dataset.open).toBe('false');
  });

  it('из окна настроек в редактор окна создания: настройки закрываются', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Настройки типа' }));
    fireEvent.click(screen.getByText('settings-edit-window'));
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    expect(screen.getByTestId('window-builder').dataset.open).toBe('true');
  });

  it('смена выбранного типа сбрасывает вкладку на «Схему» и закрывает окна', () => {
    state.types = [TYPE('p1', 'Договор'), TYPE('p2', 'Тема')];
    const view = render(
      <ProjectTypeWorkspace
        typeId="p1"
        settingsRequest={0}
        onOpenType={() => void 0}
        onOpenKind={() => void 0}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Что здесь можно создавать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Настройки типа' }));
    expect(screen.getByTestId('settings-dialog')).toBeTruthy();

    view.rerender(
      <ProjectTypeWorkspace
        typeId="p2"
        settingsRequest={0}
        onOpenType={() => void 0}
        onOpenKind={() => void 0}
      />,
    );
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Схема' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('canvas').dataset.type).toBe('Тема');
  });
});
