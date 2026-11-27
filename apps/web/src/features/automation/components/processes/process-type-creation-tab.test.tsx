// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

// Журнальный список вкладки меряет края скролла ResizeObserver-ом.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const api = vi.hoisted(() => ({ mutate: vi.fn() }));
const openCardSpy = vi.hoisted(() => vi.fn());
// Стек карточек: строка списка кладёт карточку ПОВЕРХ, рама не переезжает.
vi.mock('../../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => openCardSpy,
}));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(),
}));

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { openRowMenu, rowOf, withRowRect } from '../../../../test/journal-row.js';
import { ProcessTypeCreationTab } from './process-type-creation-tab.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const projectType = (id: string, name: string, patch: Partial<ProjectType> = {}) =>
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

const kind = (id: string, name: string, patch: Partial<NodeKind> = {}) =>
  ({
    id,
    name,
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
    ...patch,
  }) as unknown as NodeKind;

const type = (excluded: string[] = [], patch: Partial<ProcessType> = {}) =>
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
      creation: { excludedProjectTypeIds: excluded, folderKindId: null, withoutProject: true },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...patch,
  }) as unknown as ProcessType;

const menuLabels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);

function setup(
  props: {
    excluded?: string[];
    canSave?: boolean;
    projects?: ProjectType[];
    kinds?: NodeKind[];
  } = {},
) {
  vi.mocked(useProjectTypes).mockReturnValue({
    data: props.projects ?? [
      projectType(P1, 'Договор', { kindIds: ['k1'] }),
      projectType(P2, 'Тема'),
      projectType(P3, 'Архивный', { archivedAt: '2026-11-01T00:00:00.000Z' }),
    ],
  } as never);
  vi.mocked(useNodeKinds).mockReturnValue({
    data: props.kinds ?? [kind('k1', 'Комплект'), kind('k2', 'Здание')],
  } as never);
  render(
    <ProcessTypeCreationTab type={type(props.excluded ?? [])} canSave={props.canSave ?? true} />,
  );
}

beforeEach(() => {
  api.mutate.mockClear();
  openCardSpy.mockClear();
  useTypeSettingsStore.setState({ target: null });
  vi.mocked(useUpdateTypeCreation).mockReturnValue({
    mutate: api.mutate,
    isPending: false,
  } as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('вкладка «Где создаётся» типа процесса — список связей (#665, #857)', () => {
  it('живые ПОДКЛЮЧЁННЫЕ типы проектов строками; исключённый и архивный скрыты', () => {
    setup({ excluded: [P1] });
    expect(screen.getByText('Тема')).toBeTruthy();
    // Исключённый и архивный типы в списке связей не участвуют.
    expect(screen.queryByText('Договор')).toBeNull();
    expect(screen.queryByText('Архивный')).toBeNull();
    // Сводка типов папок строки — как в журнале типов проектов (у «Темы»
    // kindIds=null — «все типы»; «Договор» с явным списком исключён и скрыт).
    expect(screen.getAllByText('Все типы · 2').length).toBeGreaterThan(0);
    expect(screen.getByText(/Подключено: 1/)).toBeTruthy();
  });

  it('пикер подключает тип проекта: в нём — только неподключённые живые', async () => {
    setup({ excluded: [P1] });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectProjectType }));
    // Запросы — ВНУТРИ окна пикера: за ним живёт таблица связей с теми же именами.
    const picker = within(screen.getByRole('dialog'));
    expect(picker.getByText('Договор')).toBeTruthy();
    expect(picker.queryByText('Тема')).toBeNull();
    expect(picker.queryByText('Архивный')).toBeNull();
    fireEvent.click(picker.getByRole('checkbox', { name: 'Договор' }));
    fireEvent.click(picker.getByRole('button', { name: ui.automation.entry.connectAction }));
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('«Отключить» в меню строки пишет исключение', async () => {
    setup();
    const menu = await openRowMenu('Договор');
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.entry.disconnect }));
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [P1] }),
    });
  });

  it('поиск в шапке фильтрует строки; без совпадений — пустое состояние', () => {
    setup();
    fireEvent.change(screen.getByLabelText(ui.common.search), { target: { value: 'Тема' } });
    expect(screen.queryByText('Договор')).toBeNull();
    expect(screen.getByText('Тема')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(ui.common.search), {
      target: { value: 'нет такого' },
    });
    expect(screen.getByText(ui.automation.entry.searchEmpty)).toBeTruthy();
  });

  it('чекбоксы вернулись (пакетное отключение), тумблеров и команд «над всеми» нет', () => {
    setup({ excluded: [P1] });
    // Строчные чекбоксы есть (заголовочный «выбрать все» + строки).
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Разрешить|^Запретить/ })).toHaveLength(0);
    // Пачка: выделили «Тему» — островок с «Отключить выбранные» пишет исключение.
    fireEvent.click(within(rowOf('Тема')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.disconnectSelected }));
    // Исключение ДОПОЛНЯЕТ список: P1 уже был исключён настройкой сета.
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({
        excludedProjectTypeIds: ['11111111-1111-4111-8111-111111111111', P2],
      }),
    });
  });

  it('клик по строке кладёт карточку типа проекта ПОВЕРХ с прямоугольником строки', () => {
    setup();
    const rect = withRowRect(rowOf('Договор'));
    fireEvent.click(rowOf('Договор'));
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'project-type', id: P1 }, rect]]);
  });

  it('«⋯» строки: «Открыть» — карточка в стек, «Настройки типа…» — общий стор настроек', async () => {
    setup();
    const menu = await openRowMenu('Тема');
    expect(menuLabels(menu)).toEqual([
      ui.common.open,
      ui.automation.menuSettingsType,
      ui.automation.entry.disconnect,
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'project-type', id: P2 });
    expect(openCardSpy).not.toHaveBeenCalled();

    const second = await openRowMenu('Договор');
    fireEvent.click(within(second).getByRole('menuitem', { name: ui.common.open }));
    // «Открыть» из меню — без прямоугольника источника (раскрытие из центра).
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'project-type', id: P1 }]]);
  });

  it('просмотр без права: пикера нет, «Отключить» в меню нет', async () => {
    setup({ canSave: false });
    expect(
      screen.queryByRole('button', { name: ui.automation.entry.connectProjectType }),
    ).toBeNull();
    const menu = await openRowMenu('Договор');
    expect(
      within(menu).queryByRole('menuitem', { name: ui.automation.entry.disconnect }),
    ).toBeNull();
  });

  it('все живые типы подключены — в пикере честная заглушка', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectProjectType }));
    expect(screen.getByText(ui.automation.entry.pickerNothingLeft)).toBeTruthy();
  });
});
