// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const state = vi.hoisted(() => ({ types: [] as ProjectType[] }));

vi.mock('../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(() => ({ data: [] })),
}));
// projectsKeys нужны транзитивным импортам мутаций каталога (не только хук).
vi.mock('../../../shared/api/projects-list.js', () => ({
  projectsKeys: { all: ['projects'], list: ['projects', 'list'] },
  useProjectTypes: vi.fn(() => ({ data: state.types })),
}));
const permissions = vi.hoisted(() => ({ value: ['project.setup.manage'] }));
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: permissions.value } }),
}));
vi.mock('../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: () => true,
}));

vi.mock('./project-schema-canvas.js', () => ({
  ProjectSchemaCanvas: (props: {
    type: ProjectType;
    canSetup: boolean;
    onOpenForm: () => void;
  }) => (
    <div
      data-testid="canvas"
      data-type={props.type.name}
      data-can-setup={props.canSetup ? 'yes' : 'no'}
    >
      <button type="button" onClick={props.onOpenForm}>
        canvas-node
      </button>
    </div>
  ),
}));
vi.mock('./project-type-creation.js', () => ({
  ProjectTypeCreationTab: (props: { type: ProjectType; renderProcessTypeCreate?: unknown }) => (
    <div
      data-testid="creation-tab"
      data-type={props.type.name}
      data-create-slot={props.renderProcessTypeCreate ? 'yes' : 'no'}
    />
  ),
}));
vi.mock('./project-type-kinds.js', () => ({
  ProjectTypeKindsTab: (props: { type: ProjectType; canSetup: boolean }) => (
    <div
      data-testid="kinds-tab"
      data-type={props.type.name}
      data-can-setup={props.canSetup ? 'yes' : 'no'}
    />
  ),
}));
/** Автосохранение формы — здесь только рама: состояние линии бара и вызовы. */
const autosave = vi.hoisted(() => ({
  state: 'idle' as string,
  edit: vi.fn(),
  retry: vi.fn(),
  flush: vi.fn(),
}));
vi.mock('./project-type-form-tab.js', () => ({
  useProjectTypeForm: () => autosave,
  ProjectTypeFormTab: (props: {
    type: ProjectType;
    canSetup: boolean;
    renderCreateField?: unknown;
  }) => (
    <div
      data-testid="form-tab"
      data-type={props.type.name}
      data-can-setup={props.canSetup ? 'yes' : 'no'}
      data-create-field-slot={props.renderCreateField ? 'yes' : 'no'}
    />
  ),
}));

import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
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

type RenderProcessTypeCreate = NonNullable<
  Parameters<typeof ProjectTypeWorkspace>[0]['renderProcessTypeCreate']
>;

function setup(typeId: string, renderProcessTypeCreate?: RenderProcessTypeCreate) {
  render(
    <ProjectTypeWorkspace typeId={typeId} renderProcessTypeCreate={renderProcessTypeCreate} />,
  );
}

const TAB = {
  schema: ui.projects.schemasTabSchema,
  form: ui.automation.entry.formTab,
  creation: ui.projects.schemasCreationPage,
  kinds: ui.projects.schemasKinds,
};
const tabLabels = () =>
  within(screen.getByRole('tablist'))
    .getAllByRole('tab')
    .map((tab) => tab.textContent?.trim());

beforeEach(() => {
  permissions.value = ['project.setup.manage'];
  autosave.state = 'idle';
  useTypeSettingsStore.setState({ target: null });
});

afterEach(() => {
  cleanup();
  state.types = [];
  vi.clearAllMocks();
});

describe('тип проекта в раме «Процессов» — одна схема на все сущности (#857, ревизия UI v3)', () => {
  it('вкладки: «Схема» · «Форма создания» · «Что здесь можно создавать» · «Какие папки здесь бывают»', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(tabLabels()).toEqual([TAB.schema, TAB.form, TAB.creation, TAB.kinds]);
    expect(screen.getByRole('tab', { name: TAB.schema }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('первая вкладка — холст выбранного типа; чужой id — пустое состояние', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.getByTestId('canvas').dataset.type).toBe('Договор');
    cleanup();
    setup('missing');
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(screen.getByText(ui.projects.typesEmpty)).toBeTruthy();
  });

  it('вкладки рамы переключают содержание: холст → форма → создание → папки', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByRole('tab', { name: TAB.form }));
    expect(screen.getByTestId('form-tab').dataset.type).toBe('Договор');
    expect(screen.queryByTestId('canvas')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: TAB.creation }));
    expect(screen.getByTestId('creation-tab').dataset.type).toBe('Договор');
    expect(screen.queryByTestId('form-tab')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: TAB.kinds }));
    expect(screen.getByTestId('kinds-tab').dataset.type).toBe('Договор');
    // Обратно к холсту — та же рама, без потери выбора.
    fireEvent.click(screen.getByRole('tab', { name: TAB.schema }));
    expect(screen.getByTestId('canvas').dataset.type).toBe('Договор');
  });

  it('узел холста «Создание проекта» включает вкладку «Форма создания» — без отдельного окна', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByText('canvas-node'));
    expect(screen.getByRole('tab', { name: TAB.form }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('form-tab').dataset.type).toBe('Договор');
    // Окна-конструктора больше нет: стор настроек хранит только цель окна настроек.
    expect(useTypeSettingsStore.getState().target).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('уход с вкладки формы сохраняет недавнюю правку сразу; с остальных вкладок — нечего сохранять', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    fireEvent.click(screen.getByRole('tab', { name: TAB.form }));
    fireEvent.click(screen.getByRole('tab', { name: TAB.schema }));
    expect(autosave.flush).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: TAB.kinds }));
    fireEvent.click(screen.getByRole('tab', { name: TAB.schema }));
    expect(autosave.flush).toHaveBeenCalledTimes(1);
  });

  it('слева от шестерёнки — тихая строка автосохранения: «Сохранение…», при ошибке «Не сохранилось» и «Повторить»', () => {
    state.types = [TYPE('p1', 'Договор')];
    autosave.state = 'saving';
    setup('p1');
    const bar = screen.getByRole('tablist').parentElement!.parentElement!;
    expect(bar.textContent).toContain(ui.forms.builder.saving);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    autosave.state = 'error';
    setup('p1');
    const line = screen.getByRole('alert');
    expect(line.textContent).toContain(ui.forms.builder.notSaved);
    fireEvent.click(within(line).getByRole('button', { name: ui.forms.builder.retry }));
    expect(autosave.retry).toHaveBeenCalledTimes(1);
  });

  it('бар: кнопки содержимого (узел холста) в бар не входят, единственная кнопка бара — шестерёнка', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    const barButtons = screen
      .getAllByRole('button')
      .filter((button) => button.textContent !== 'canvas-node');
    expect(barButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      ui.automation.menuSettingsType,
    ]);
  });

  it('шестерёнка бара просит общий стор открыть настройки этого типа', () => {
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    // Самого окна в рабочей области нет: его рендерит резидентный хост уровня app.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'project-type', id: 'p1' });
  });

  it('слоты фичи automation доходят до своих вкладок (I6): окно типа задачи — до создания, окно атрибута — до формы', () => {
    state.types = [TYPE('p1', 'Договор')];
    const renderProcessTypeCreate = vi.fn<RenderProcessTypeCreate>(() => null);
    const renderCreateField = vi.fn(() => null);
    render(
      <ProjectTypeWorkspace
        typeId="p1"
        renderProcessTypeCreate={renderProcessTypeCreate}
        renderCreateField={renderCreateField}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: TAB.creation }));
    expect(screen.getByTestId('creation-tab').dataset.createSlot).toBe('yes');
    fireEvent.click(screen.getByRole('tab', { name: TAB.form }));
    expect(screen.getByTestId('form-tab').dataset.createFieldSlot).toBe('yes');
  });

  it('без права настройки холст, форма и вкладка папок получают canSetup=false', () => {
    permissions.value = [];
    state.types = [TYPE('p1', 'Договор')];
    setup('p1');
    expect(screen.getByTestId('canvas').dataset.canSetup).toBe('no');
    fireEvent.click(screen.getByRole('tab', { name: TAB.form }));
    expect(screen.getByTestId('form-tab').dataset.canSetup).toBe('no');
    fireEvent.click(screen.getByRole('tab', { name: TAB.kinds }));
    expect(screen.getByTestId('kinds-tab').dataset.canSetup).toBe('no');
  });

  it('смена выбранного типа сбрасывает вкладку на «Схему»', () => {
    state.types = [TYPE('p1', 'Договор'), TYPE('p2', 'Тема')];
    const view = render(<ProjectTypeWorkspace typeId="p1" />);
    fireEvent.click(screen.getByRole('tab', { name: TAB.form }));
    expect(screen.getByTestId('form-tab')).toBeTruthy();
    act(() => view.rerender(<ProjectTypeWorkspace typeId="p2" />));
    expect(screen.queryByTestId('form-tab')).toBeNull();
    expect(screen.getByRole('tab', { name: TAB.schema }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('canvas').dataset.type).toBe('Тема');
    // Левая колонка с именами типов рамой не управляет — здесь только рама.
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(4);
  });
});
