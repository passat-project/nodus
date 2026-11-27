// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

vi.mock('../../../../shared/api/projects-list.js', () => ({
  // projectsKeys нужны транзитивным импортам хоста формы создания.
  projectsKeys: { all: ['projects'], list: ['projects', 'list'] },
  useProjectTypes: vi.fn(),
}));
vi.mock('../../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../editor/route-editor.js', () => ({
  RouteEditor: (props: {
    barHosts: { tools: unknown; status: unknown; primary: unknown } | null;
    form?: ReactNode;
    onOpenForm?: (field?: string) => void;
  }) => (
    <div
      data-testid="route-editor"
      data-bar-hosts={
        props.barHosts?.tools && props.barHosts.status && props.barHosts.primary ? 'yes' : 'no'
      }
      data-tools={props.barHosts?.tools ? 'yes' : 'no'}
      data-finish={props.barHosts?.status && props.barHosts?.primary ? 'yes' : 'no'}
      data-form={props.form !== undefined ? 'yes' : 'no'}
    >
      {/* Узел холста «Создание» и проблема формы в чипе проблем. */}
      <button type="button" onClick={() => props.onOpenForm?.()}>
        node-creation
      </button>
      <button type="button" onClick={() => props.onOpenForm?.('f1')}>
        problem-field
      </button>
      {props.form}
    </div>
  ),
}));
vi.mock('../editor/creation-form-tab.js', () => ({
  CreationFormTab: (props: { readOnly: boolean; focusKey: string | null }) => (
    <div
      data-testid="form-tab"
      data-read-only={props.readOnly ? 'yes' : 'no'}
      data-focus={props.focusKey ?? ''}
    />
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

import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';
import { ProcessTypeCard } from './process-type-card.js';

const TAB = {
  route: ui.automation.typeSettings.tabRoute,
  form: ui.automation.entry.formTab,
  creation: ui.automation.typeSettings.sections.creation,
};

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

function setup(
  patch: {
    type?: ProcessType;
    suspended?: boolean;
    idPrefix?: string;
    /** `null` — маршрута ещё нет (грузится). */
    workflow?: typeof WORKFLOW | null;
  } = {},
) {
  const state = {
    type: patch.type ?? TYPE(),
    renderProjectTypeCreate: vi.fn(() => <div data-testid="project-create-slot" />),
  };
  const view = render(
    <ProcessTypeCard
      type={state.type}
      workflow={patch.workflow === null ? undefined : (patch.workflow ?? WORKFLOW)}
      suspended={patch.suspended}
      idPrefix={patch.idPrefix}
      renderProjectTypeCreate={state.renderProjectTypeCreate}
    />,
  );
  return { view, state };
}

const tab = (name: string) => screen.getByRole('tab', { name });
const selected = (name: string) => tab(name).getAttribute('aria-selected') === 'true';

beforeEach(() => {
  vi.mocked(useProjectTypes).mockReturnValue({
    data: [PROJECT('p1', 'Договор'), PROJECT('p2', 'Тема', { archivedAt: '2026-11-01' })],
  } as never);
  useTypeSettingsStore.setState({ target: null });
  useRouteDocStore.setState({ selection: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('карточка типа процесса — рама с вкладками (#857, ревизия UI v3)', () => {
  it('вкладки «Маршрут» · «Форма создания» · «Где создаётся»; «Маршрут» по умолчанию с тремя хостами бара', () => {
    setup();
    const list = screen.getByRole('tablist', { name: ui.automation.entry.typeTabsAria });
    expect(
      within(list)
        .getAllByRole('tab')
        .map((item) => item.textContent?.trim()),
    ).toEqual([TAB.route, TAB.form, TAB.creation]);
    expect(selected(TAB.route)).toBe(true);
    // Инструменты, состояние и главная кнопка живут в едином баре — редактор
    // получает все три хоста.
    expect(screen.getByTestId('route-editor').getAttribute('data-bar-hosts')).toBe('yes');
    expect(screen.queryByTestId('creation-tab')).toBeNull();
    expect(screen.queryByTestId('form-tab')).toBeNull();
    // Имя и значок типа — только в строке колонки слева / заголовке карточки.
    expect(screen.queryByText('Задание смежнику')).toBeNull();
    // Крошек «назад» у рамы нет: в баре единственная кнопка — шестерёнка.
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => !['node-creation', 'problem-field'].includes(button.textContent ?? ''))
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([ui.automation.menuSettingsType]);
  });

  it('вкладка «Форма создания»: тот же редактор и общий бар, инструментов холста нет (#857, единая модель)', () => {
    setup();
    fireEvent.click(tab(TAB.form));
    expect(selected(TAB.form)).toBe(true);
    const editor = screen.getByTestId('route-editor');
    // Форма рисуется редактором вместо холста и правой панели.
    expect(editor.getAttribute('data-form')).toBe('yes');
    expect(screen.getByTestId('form-tab')).toBeTruthy();
    // Инструменты холста — только на «Маршруте»; чип проблем и «Опубликовать» общие.
    expect(editor.getAttribute('data-tools')).toBe('no');
    expect(editor.getAttribute('data-finish')).toBe('yes');
    // Инструменты не оставляют разделителя в баре.
    expect(screen.getByRole('tablist').parentElement!.querySelector('.w-px')).toBeNull();
    // Форма правится: у типа задачи есть право настройки.
    expect(screen.getByTestId('form-tab').getAttribute('data-read-only')).toBe('no');

    fireEvent.click(tab(TAB.route));
    expect(screen.getByTestId('route-editor').getAttribute('data-tools')).toBe('yes');
    expect(screen.queryByTestId('form-tab')).toBeNull();
  });

  it('клик по узлу «Создание» включает вкладку формы и снимает выделение узла — панель не откроется сама', () => {
    setup();
    act(() => useRouteDocStore.getState().select({ kind: 'stage', id: 's1' }));
    fireEvent.click(screen.getByText('node-creation'));
    expect(selected(TAB.form)).toBe(true);
    expect(useRouteDocStore.getState().selection).toBeNull();
    expect(screen.getByTestId('form-tab').getAttribute('data-focus')).toBe('');
  });

  it('проблема формы в чипе ведёт на вкладку формы и раскрывает настройки поля', () => {
    setup();
    fireEvent.click(screen.getByText('problem-field'));
    expect(selected(TAB.form)).toBe(true);
    expect(screen.getByTestId('form-tab').getAttribute('data-focus')).toBe('f1');
  });

  it('возврат с формы на «Маршрут» снимает выделение узла', () => {
    setup();
    fireEvent.click(tab(TAB.form));
    // Выделение могло остаться от холста (например, добавили статус).
    act(() => useRouteDocStore.getState().select({ kind: 'stage', id: 's1' }));
    fireEvent.click(tab(TAB.route));
    expect(selected(TAB.route)).toBe(true);
    expect(useRouteDocStore.getState().selection).toBeNull();
  });

  it('вкладка «Где создаётся»: редактор снят, слот создания оставлен, сохранение доступно', () => {
    setup();
    fireEvent.click(tab(TAB.creation));
    const creation = screen.getByTestId('creation-tab');
    expect(selected(TAB.creation)).toBe(true);
    expect(creation.getAttribute('data-can-save')).toBe('yes');
    // Слот окна создания типа проекта прокинут из фичи projects (I6).
    expect(creation.getAttribute('data-create-slot')).toBe('yes');
    expect(screen.queryByTestId('route-editor')).toBeNull();
  });

  it('шестерёнка бара открывает окно настроек через общий стор', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'process-type', id: 't1' });
  });

  it('маршрут ещё грузится: рама с вкладками на месте, панель «Маршрут» пустая — редактора нет', () => {
    setup({ workflow: null });
    expect(screen.queryByTestId('route-editor')).toBeNull();
    expect(selected(TAB.route)).toBe(true);
    // Остальные поверхности карточки живут: вкладки переключаются.
    fireEvent.click(tab(TAB.creation));
    expect(screen.getByTestId('creation-tab')).toBeTruthy();
  });

  it('suspended: панель редактора пустая на «Маршруте» и на форме — один редактор на экран', () => {
    // Правило одного редактора: стор глобальный, второй редактор затирал бы первый.
    setup({ suspended: true });
    expect(screen.queryByTestId('route-editor')).toBeNull();
    expect(selected(TAB.route)).toBe(true);
    fireEvent.click(tab(TAB.form));
    expect(selected(TAB.form)).toBe(true);
    expect(screen.queryByTestId('route-editor')).toBeNull();
    expect(screen.queryByTestId('form-tab')).toBeNull();
    // Остальные поверхности карточки живут: вкладки переключаются.
    fireEvent.click(tab(TAB.creation));
    expect(screen.getByTestId('creation-tab')).toBeTruthy();
  });

  it('строки-подсказки «Используется в» над холстом нет: фон доходит до бара', () => {
    setup();
    // Тип разрешён везде — но строка места типа больше не рисуется (замечание
    // владельца 27.11): над содержимым только бар, без полосы подсказки.
    expect(screen.queryByText(ui.automation.entry.usageEverywhere)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Договор' })).toBeNull();
  });

  it('смена типа сбрасывает вкладку на «Маршрут»', () => {
    const { view, state } = setup();
    fireEvent.click(tab(TAB.form));
    expect(screen.getByTestId('form-tab')).toBeTruthy();

    const next = TYPE({ id: 't2', name: 'Смета' });
    act(() => {
      view.rerender(
        <ProcessTypeCard
          type={next}
          workflow={WORKFLOW}
          renderProjectTypeCreate={state.renderProjectTypeCreate}
        />,
      );
    });
    expect(screen.queryByTestId('form-tab')).toBeNull();
    expect(selected(TAB.route)).toBe(true);
  });

  it('idPrefix вкладок можно задать — карточка стека не дублирует id рамы', () => {
    setup({ idPrefix: 'process-type-card-t1' });
    expect(tab(TAB.route).getAttribute('id')).toBe('process-type-card-t1-route-tab');
    expect(tab(TAB.form).getAttribute('id')).toBe('process-type-card-t1-form-tab');
  });

  it('письмо (системный каталог): всё только для чтения, форма — просмотр, чип «Только чтение» в баре', () => {
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
    fireEvent.click(tab(TAB.form));
    expect(screen.getByTestId('form-tab').getAttribute('data-read-only')).toBe('yes');
    fireEvent.click(tab(TAB.creation));
    // У письма связка «где создаётся» не сохраняется — тумблеры выключены.
    expect(screen.getByTestId('creation-tab').getAttribute('data-can-save')).toBe('no');
  });
});
