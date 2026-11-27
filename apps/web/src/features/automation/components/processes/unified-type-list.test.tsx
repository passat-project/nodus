// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../../api/automation-api.js', () => ({
  useArchiveProcessType: vi.fn(() => ({ mutate: vi.fn() })),
}));

const dialogProps = vi.hoisted(() => ({
  last: null as null | { defaultBaseTypeId?: string },
  onClose: () => {},
}));
vi.mock('../types/type-create-dialog.js', () => ({
  ProcessTypeCreateDialog: (props: { defaultBaseTypeId?: string; onClose: () => void }) => {
    dialogProps.last = props;
    dialogProps.onClose = props.onClose;
    return <div data-testid="task-create-dialog" />;
  },
}));

import { UnifiedTypeList } from './unified-type-list.js';

const NOW = '2026-11-26T00:00:00.000Z';

const task = (id: string, name: string, patch: Partial<ProcessType> = {}) =>
  ({
    id,
    code: id,
    name,
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
    config: {
      card: {},
      access: {},
      creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
    },
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...patch,
  }) as unknown as ProcessType;

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

const fixtures = {
  processTypes: [
    task('t1', 'Задание смежнику'),
    task('t2', 'Смета', { category: 'letter' }),
    task('t-dead', 'Старый тип', { archivedAt: NOW }),
  ],
  projectTypes: [projectType('p1', 'Договор'), projectType('p2', 'Тема', { archivedAt: NOW })],
  kinds: [kind('k1', 'Комплект'), kind('k2', 'Здание', { archivedAt: NOW })],
};

function SlotProbe(props: Partial<Parameters<typeof UnifiedTypeList>[0]>) {
  return (
    <UnifiedTypeList
      {...(props as Parameters<typeof UnifiedTypeList>[0])}
      renderProjectTypeCreate={
        props.renderProjectTypeCreate ?? (() => <div data-testid="project-create-slot" />)
      }
      renderKindCreate={props.renderKindCreate ?? (() => <div data-testid="kind-create-slot" />)}
    />
  );
}

function setup(patch: Partial<Parameters<typeof UnifiedTypeList>[0]> = {}) {
  const props = {
    processTypes: fixtures.processTypes,
    projectTypes: fixtures.projectTypes,
    kinds: fixtures.kinds,
    canSetup: true,
    canManage: true,
    isLoading: false,
    dirtyIds: new Set<string>(),
    noProjectSelected: false,
    onSelectProcessType: vi.fn(),
    onOpenProcessTypeSettings: vi.fn(),
    onSelectProjectType: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onSelectNoProject: vi.fn(),
    onSelectKind: vi.fn(),
    onArchiveProject: vi.fn(),
    onArchiveNodeKind: vi.fn(),
    ...patch,
  };
  render(<SlotProbe {...props} />);
  return props;
}

function groupOf(label: string): HTMLElement {
  // Заголовок группы — кнопка сворачивания с меткой; группа — её родитель.
  return screen.getByRole('button', { name: new RegExp(label) }).closest('div')!
    .parentElement as HTMLElement;
}

describe('единая колонка «Процессов» (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('четыре группы в строгом порядке, «Без проекта» — последняя строка «Проектов»', () => {
    setup();
    const labels = [
      ui.automation.entry.groups.project,
      ui.automation.entry.groups.task,
      ui.automation.entry.groups.letter,
      ui.automation.entry.groups.folder,
    ];
    const nodes = labels.map((label) => screen.getByText(label));
    for (let i = 1; i < nodes.length; i += 1) {
      // Following (4) — заголовок i стоит в документе после заголовка i-1.
      expect((nodes[i - 1]!.compareDocumentPosition(nodes[i]!) & 4) !== 0).toBe(true);
    }
    const projects = groupOf(ui.automation.entry.groups.project);
    const rows = within(projects)
      .getAllByRole('button')
      .filter(
        (button) =>
          button.textContent !== null &&
          !button.textContent.includes(ui.automation.entry.groups.project),
      );
    expect(within(rows[rows.length - 1]!).getByText(ui.automation.entry.noProjectRow)).toBeTruthy();
  });

  it('без права project.setup.manage проектные группы скрыты', () => {
    setup({ canSetup: false });
    expect(screen.queryByText(ui.automation.entry.groups.project)).toBeNull();
    expect(screen.queryByText(ui.automation.entry.groups.folder)).toBeNull();
    expect(screen.getByText(ui.automation.entry.groups.task)).toBeTruthy();
    expect(screen.getByText(ui.automation.entry.groups.letter)).toBeTruthy();
    expect(screen.queryByText(ui.automation.entry.noProjectRow)).toBeNull();
  });

  it('поиск фильтрует все группы, раскрывает свёрнутую, прячет пустые', () => {
    setup();
    // свернуть «Задачи» до поиска
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(ui.automation.entry.groups.task) }),
    );
    expect(screen.queryByText('Задание смежнику')).toBeNull();

    const search = screen.getByPlaceholderText(ui.common.search);
    fireEvent.change(search, { target: { value: 'договор' } });
    // группа «Задачи» без найденного скрыта целиком
    expect(screen.queryByText(ui.automation.entry.groups.task)).toBeNull();
    expect(screen.queryByText('Задание смежнику')).toBeNull();
    // «Проекты» раскрыта поиском и показывает найденное
    expect(screen.getByText('Договор')).toBeTruthy();
  });

  it('поиск «смеж» раскрывает свёрнутую группу «Задачи»', () => {
    setup();
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(ui.automation.entry.groups.task) }),
    );
    fireEvent.change(screen.getByPlaceholderText(ui.common.search), { target: { value: 'смеж' } });
    expect(screen.getByText('Задание смежнику')).toBeTruthy();
  });

  it('сворачивание и разворачивание группы кликом по заголовку', () => {
    setup();
    const header = screen.getByRole('button', {
      name: new RegExp(ui.automation.entry.groups.letter),
    });
    fireEvent.click(header);
    expect(screen.queryByText('Смета')).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText('Смета')).toBeTruthy();
  });

  it('архив — свёрнутая группа внизу со всеми категориями вместе', () => {
    setup();
    const archive = screen.getByRole('button', { name: new RegExp(ui.automation.archiveGroup) });
    expect(screen.queryByText('Старый тип')).toBeNull();
    fireEvent.click(archive);
    expect(screen.getByText('Старый тип')).toBeTruthy();
    expect(screen.getByText('Тема')).toBeTruthy();
    expect(screen.getByText('Здание')).toBeTruthy();
  });

  it('пустая группа — тихая заглушка; «+» шапки создаёт тип задачи без основы (#857, модель связей)', async () => {
    // Создание — единственная точка колонки: меню «+» справа от поиска.
    setup({
      processTypes: [fixtures.processTypes[1]!, fixtures.processTypes[2]!],
    });
    expect(screen.getByText(ui.automation.entry.emptyGroup)).toBeTruthy();
    // В заглушке НЕТ второй кнопки создания — только «+» шапки.
    expect(screen.queryByRole('button', { name: ui.automation.newType })).toBeNull();
    const plus = screen.getByRole('button', { name: ui.automation.entry.columnCreate });
    fireEvent.pointerDown(plus, { button: 0, pointerType: 'mouse' });
    fireEvent.click(plus);
    fireEvent.click(
      await screen.findByRole('menuitem', { name: ui.automation.entry.createTaskType }),
    );
    expect(screen.getByTestId('task-create-dialog')).toBeTruthy();
    expect(dialogProps.last!.defaultBaseTypeId).toBeUndefined();
    // закрытие снимает диалог
    act(() => dialogProps.onClose());
    expect(screen.queryByTestId('task-create-dialog')).toBeNull();
  });

  it('«⋯ → Копировать тип» строки задачи — диалог с основой (регрессия #857)', async () => {
    setup();
    const taskRow = screen.getByText('Задание смежнику').closest('button')!.parentElement!;
    const menu = within(taskRow).getByRole('button', { name: ui.common.rowMenu });
    fireEvent.pointerDown(menu, { button: 0, pointerType: 'mouse' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.automation.menuCopyType }));
    expect(screen.getByTestId('task-create-dialog')).toBeTruthy();
    expect(dialogProps.last!.defaultBaseTypeId).toBe('t1');
  });

  it('«Проекты» без типов — остаётся строка «Без проекта»; слот копии строки передаёт основу и выбор', async () => {
    // Строка «Без проекта» держит группу непустой: кнопки создания в ней нет.
    setup({ projectTypes: [] });
    expect(screen.getAllByText(ui.automation.entry.noProjectRow).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: ui.projects.typesCreate })).toBeNull();

    // Слот создания проекта — из «⋯ → Копировать тип» строки типа проекта.
    cleanup();
    const props2 = setup();
    let created: (id: string) => void = () => {};
    let base: string | undefined;
    props2.renderProjectTypeCreate = (slot) => {
      created = slot.onCreated;
      base = slot.baseId;
      return <div data-testid="slot" />;
    };
    cleanup();
    render(<SlotProbe {...props2} />);
    const projectRow = screen.getByText('Договор').closest('button')!.parentElement!;
    const menu = within(projectRow).getByRole('button', { name: ui.common.rowMenu });
    fireEvent.pointerDown(menu, { button: 0, pointerType: 'mouse' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.automation.menuCopyType }));
    expect(screen.getByTestId('slot')).toBeTruthy();
    expect(base).toBe('p1');
    act(() => created('new-p'));
    expect(props2.onSelectProjectType).toHaveBeenCalledWith('new-p');
  });

  it('«+» шапки → «Тип папки»: слот создания открывается и выбирает созданное', async () => {
    const props = setup({ kinds: [] });
    let created: (id: string) => void = () => {};
    props.renderKindCreate = (slot) => {
      created = slot.onCreated;
      return <div data-testid="kind-slot" />;
    };
    cleanup();
    render(<SlotProbe {...props} />);
    const plus = screen.getByRole('button', { name: ui.automation.entry.columnCreate });
    fireEvent.pointerDown(plus, { button: 0, pointerType: 'mouse' });
    fireEvent.click(plus);
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.projects.schemasCreateKind }));
    expect(screen.getByTestId('kind-slot')).toBeTruthy();
    created('new-k');
    expect(props.onSelectKind).toHaveBeenCalledWith('new-k');
  });

  it('поиск фильтрует и архивную секцию', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ui.automation.archiveGroup) }));
    // без поиска в архиве все три категории
    expect(screen.getByText('Старый тип')).toBeTruthy();
    expect(screen.getByText('Тема')).toBeTruthy();
    expect(screen.getByText('Здание')).toBeTruthy();
    // поиск по архивному типу проекта оставляет только его
    fireEvent.change(screen.getByPlaceholderText(ui.common.search), {
      target: { value: 'тема' },
    });
    expect(screen.getByText('Тема')).toBeTruthy();
    expect(screen.queryByText('Старый тип')).toBeNull();
    expect(screen.queryByText('Здание')).toBeNull();
  });

  it('клик по строке вызывает выбор соответствующей категории', () => {
    const props = setup();
    fireEvent.click(screen.getByText('Задание смежнику'));
    expect(props.onSelectProcessType).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByText('Договор'));
    expect(props.onSelectProjectType).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByText('Комплект'));
    expect(props.onSelectKind).toHaveBeenCalledWith('k1');
    fireEvent.click(screen.getByText(ui.automation.entry.noProjectRow));
    expect(props.onSelectNoProject).toHaveBeenCalled();
  });
});
