// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(),
}));
vi.mock('../../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../editor/route-editor.js', () => ({
  RouteEditor: (props: { actionsHost: HTMLElement | null }) => (
    <div data-testid="route-editor" data-actions-host={props.actionsHost ? 'yes' : 'no'} />
  ),
}));
vi.mock('./process-type-creation-tab.js', () => ({
  ProcessTypeCreationTab: (props: { canSave: boolean; renderProjectTypeCreate?: unknown }) => (
    <div
      data-testid="creation-tab"
      data-can-save={props.canSave ? 'yes' : 'no'}
      data-create-slot={props.renderProjectTypeCreate ? 'yes' : 'no'}
    />
  ),
}));
const dialog = vi.hoisted(() => ({ props: null as null | { onClose: () => void } }));
vi.mock('./process-type-settings-dialog.js', () => ({
  ProcessTypeSettingsDialog: (props: { type: ProcessType; onClose: () => void }) => {
    dialog.props = props;
    return (
      <div data-testid="settings-dialog" data-type={props.type.name}>
        <button type="button" onClick={props.onClose}>
          dialog-close
        </button>
      </div>
    );
  },
}));

import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { ProcessTypeCard } from './process-type-card.js';

const PROJECT = (id: string, name: string, patch: Partial<ProjectType> = {}) =>
  ({
    id,
    name,
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
    ...patch,
  }) as unknown as ProjectType;

const TYPE = (patch: Partial<ProcessType> = {}) =>
  ({
    id: 't1',
    code: 't1',
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
    workflowId: 'wf-1',
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...patch,
  }) as unknown as ProcessType;

const WORKFLOW = {
  id: 'wf-1',
  typeIds: ['t1'],
  version: 1,
  publishedAt: null,
  publishedBy: null,
  document: { stages: [], transitions: [] },
  stageEntityCounts: {},
} as never;

function setup(patch: { type?: ProcessType; settingsRequest?: number; backLabel?: string } = {}) {
  const onBack = vi.fn();
  const state = {
    type: patch.type ?? TYPE(),
    settingsRequest: patch.settingsRequest ?? 0,
    backLabel: patch.backLabel,
    onBack,
    renderProjectTypeCreate: vi.fn(() => <div data-testid="project-create-slot" />),
  };
  const view = render(
    <ProcessTypeCard
      type={state.type}
      workflow={WORKFLOW}
      settingsRequest={state.settingsRequest}
      backLabel={state.backLabel}
      onBack={state.onBack}
      renderProjectTypeCreate={state.renderProjectTypeCreate}
    />,
  );
  return { view, state, onBack };
}

beforeEach(() => {
  vi.mocked(useProjectTypes).mockReturnValue({
    data: [PROJECT('p1', 'Договор'), PROJECT('p2', 'Тема', { archivedAt: '2026-11-01' })],
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('карточка типа процесса — рама с вкладками (#857)', () => {
  it('«Маршрут» по умолчанию: редактор получает хост действий полосы, имя типа не дублируется', () => {
    setup();
    const routeTab = screen.getByRole('tab', { name: ui.automation.typeSettings.tabRoute });
    expect(routeTab.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByRole('tab', { name: ui.automation.typeSettings.sections.creation }),
    ).toBeTruthy();
    // Действия вкладки «Маршрут» живут в едином баре — редактор получает хост.
    expect(screen.getByTestId('route-editor').getAttribute('data-actions-host')).toBe('yes');
    expect(screen.queryByTestId('creation-tab')).toBeNull();
    // Имя и значок типа — только в строке колонки слева.
    expect(screen.queryByText('Задание смежнику')).toBeNull();
  });

  it('вкладка «Где создаётся»: редактор снят, слот создания оставлен, сохранение доступно', () => {
    setup();
    fireEvent.click(
      screen.getByRole('tab', { name: ui.automation.typeSettings.sections.creation }),
    );
    const creation = screen.getByTestId('creation-tab');
    expect(
      screen
        .getByRole('tab', { name: ui.automation.typeSettings.sections.creation })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(creation.getAttribute('data-can-save')).toBe('yes');
    // Слот окна создания типа проекта прокинут из фичи projects (I6).
    expect(creation.getAttribute('data-create-slot')).toBe('yes');
    expect(screen.queryByTestId('route-editor')).toBeNull();
  });

  it('шестерёнка открывает окно настроек, закрытие — через onClose окна', () => {
    setup();
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.typeSettings.title }));
    expect(screen.getByTestId('settings-dialog').getAttribute('data-type')).toBe(
      'Задание смежнику',
    );
    fireEvent.click(screen.getByRole('button', { name: 'dialog-close' }));
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
  });

  it('команда «⋯ → Настройки типа…» строки колонки открывает окно (settingsRequest)', () => {
    const { view, state } = setup();
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    act(() => {
      view.rerender(
        <ProcessTypeCard
          type={state.type}
          workflow={WORKFLOW}
          settingsRequest={1}
          onBack={state.onBack}
        />,
      );
    });
    expect(screen.getByTestId('settings-dialog')).toBeTruthy();
  });

  it('подсказка «Используется в» и крошка «‹ Договор» — в тихой строке под баром', () => {
    const { onBack } = setup({ backLabel: 'Договор' });
    // Один живой тип проекта, тип разрешён везде (архивный не считается).
    expect(screen.getByText(ui.automation.entry.usageEverywhere)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Договор' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('смена типа сбрасывает вкладку на «Маршрут» и закрывает окно настроек', () => {
    const { view, state } = setup();
    fireEvent.click(
      screen.getByRole('tab', { name: ui.automation.typeSettings.sections.creation }),
    );
    fireEvent.click(screen.getByRole('button', { name: ui.automation.typeSettings.title }));
    expect(screen.getByTestId('settings-dialog')).toBeTruthy();

    const next = TYPE({ id: 't2', name: 'Смета' });
    act(() => {
      view.rerender(
        <ProcessTypeCard
          type={next}
          workflow={WORKFLOW}
          settingsRequest={state.settingsRequest}
          backLabel={state.backLabel}
          onBack={state.onBack}
        />,
      );
    });
    expect(screen.getByTestId('route-editor')).toBeTruthy();
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    expect(
      screen
        .getByRole('tab', { name: ui.automation.typeSettings.tabRoute })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('письмо (системный каталог): всё только для чтения, мета с чипом «Только чтение»', () => {
    setup({
      type: TYPE({
        id: 'l1',
        name: 'Входящее письмо',
        category: 'letter',
        config: normalizeTypeConfig({
          creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
        }),
      }),
    });
    expect(screen.getByText(ui.automation.readOnly)).toBeTruthy();
    expect(screen.getByText(ui.automation.entry.usageEverywhere)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('tab', { name: ui.automation.typeSettings.sections.creation }),
    );
    // У письма связка «где создаётся» не сохраняется — тумблеры выключены.
    expect(screen.getByTestId('creation-tab').getAttribute('data-can-save')).toBe('no');
  });
});
