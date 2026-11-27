// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';
import { toast } from 'sonner';

// Журнальный список вкладки меряет края скролла ResizeObserver-ом.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const openCardSpy = vi.hoisted(() => vi.fn());
// Стек карточек: строка списка кладёт карточку ПОВЕРХ, рама не переезжает.
vi.mock('../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => openCardSpy,
}));

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useCanManageWorkflows } from '../../../shared/api/use-can-manage-workflows.js';
import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { openRowMenu, rowOf, withRowRect } from '../../../test/journal-row.js';
import { ProjectTypeCreationTab } from './project-type-creation.js';

vi.mock('../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(),
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));

const PROJECT_TYPE_ID = '11111111-1111-4111-8111-111111111111';

const projectType = {
  id: PROJECT_TYPE_ID,
  name: 'Договор',
  icon: 'file-text',
  color: 'blue',
  form: { fields: [] },
  kindIds: null,
  archivedAt: null,
} as unknown as ProjectType;

function processType(patch: {
  id: string;
  name: string;
  category: 'task' | 'letter';
  excluded?: string[];
}): ProcessType {
  return {
    id: patch.id,
    code: patch.id,
    name: patch.name,
    category: patch.category,
    direction: patch.category === 'letter' ? 'incoming' : null,
    icon: 'file-text',
    color: 'info',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: '22222222-2222-4222-8222-222222222222',
    config: normalizeTypeConfig({
      creation: {
        excludedProjectTypeIds: patch.excluded ?? [],
        folderKindId: null,
        withoutProject: true,
      },
    }),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
  } as ProcessType;
}

const TASK = processType({ id: 't1', name: 'Комплект', category: 'task' });
const OFF_TASK = processType({
  id: 't2',
  name: 'Задание смежнику',
  category: 'task',
  excluded: [PROJECT_TYPE_ID],
});
const LETTER = processType({
  id: 'l1',
  name: 'Входящее письмо',
  category: 'letter',
  excluded: [PROJECT_TYPE_ID],
});

function setup(
  canSetup = true,
  tasks: ProcessType[] = [TASK, OFF_TASK],
  letters: ProcessType[] = [LETTER],
  manage = true,
) {
  const mutate = vi.fn();
  openCardSpy.mockClear();
  useTypeSettingsStore.setState({ target: null });
  vi.mocked(useCanManageWorkflows).mockReturnValue(manage);
  vi.mocked(useLiveProcessTypes).mockImplementation(
    (category) =>
      ({
        data: category === 'task' ? tasks : letters,
      }) as never,
  );
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  render(<ProjectTypeCreationTab type={projectType} canSetup={canSetup} />);
  return { mutate };
}

describe('вкладка «Что здесь можно создавать» — список связей (#665, #857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('показывает только ПОДКЛЮЧЁННЫЕ типы задач; письма системные — их здесь нет', () => {
    setup();
    expect(screen.getByText('Комплект')).toBeTruthy();
    // Отключённый тип и письмо в списке связей не видны.
    expect(screen.queryByText('Задание смежнику')).toBeNull();
    expect(screen.queryByText('Входящее письмо')).toBeNull();
    // Сводка — числом связей, а не «N из M».
    expect(screen.getByText(/Подключено: 1/)).toBeTruthy();
  });

  it('пикер подключает тип из справочника: неподключённые — в списке пикера', async () => {
    const { mutate } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectTaskType }));
    // Запросы — ВНУТРИ окна пикера: за ним живёт таблица связей.
    const picker = within(screen.getByRole('dialog'));
    expect(picker.getByText('Задание смежнику')).toBeTruthy();
    expect(picker.queryByText('Комплект')).toBeNull();
    expect(picker.queryByText('Входящее письмо')).toBeNull();
    fireEvent.click(picker.getByRole('checkbox', { name: 'Задание смежнику' }));
    fireEvent.click(picker.getByRole('button', { name: ui.automation.entry.connectAction }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: OFF_TASK.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('«Отключить» в меню строки пишет исключение — связь снята, тип жив в справочнике', async () => {
    const { mutate } = setup();
    const menu = await openRowMenu('Комплект');
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.entry.disconnect }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: TASK.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [PROJECT_TYPE_ID] }),
    });
  });

  it('отключение работы, привязанной к разрешённому типу папки, — предупреждение', async () => {
    const bound = {
      ...TASK,
      config: normalizeTypeConfig({
        creation: {
          excludedProjectTypeIds: [],
          folderKindId: '33333333-3333-4333-8333-333333333333',
          withoutProject: false,
        },
      }),
    } as ProcessType;
    setup(true, [bound]);
    const menu = await openRowMenu('Комплект');
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.entry.disconnect }));
    expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      ui.automation.creationScope.unbindWarning,
    );
  });

  it('чекбоксы + островок: «Отключить выбранные» пишет исключения пачкой', () => {
    const { mutate } = setup(true, [TASK, OFF_TASK]);
    // Выделим строку «Комплект» чекбоксом строки.
    fireEvent.click(within(rowOf('Комплект')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.disconnectSelected }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: TASK.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [PROJECT_TYPE_ID] }),
    });
  });

  it('без права настройки нет ни пикера, ни «Отключить» в меню', async () => {
    setup(false);
    expect(screen.queryByRole('button', { name: ui.automation.entry.connectTaskType })).toBeNull();
    const menu = await openRowMenu('Комплект');
    expect(
      within(menu).queryByRole('menuitem', { name: ui.automation.entry.disconnect }),
    ).toBeNull();
  });

  it('без права процессов — пояснение вместо 403, пикера нет', () => {
    setup(true, [TASK, OFF_TASK], [LETTER], false);
    expect(screen.getByText(ui.automation.creationScope.noWorkflowPermission)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.automation.entry.connectTaskType })).toBeNull();
  });

  it('пустой список связей — спокойная подсказка; в пикере — весь справочник', () => {
    setup(true, [OFF_TASK]);
    expect(screen.getByText(ui.automation.entry.connectedEmpty)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectTaskType }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Задание смежнику')).toBeTruthy();
  });

  it('в пикере всё уже подключено — честная заглушка, не пустота', () => {
    setup(true, [TASK]);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectTaskType }));
    expect(screen.getByText(ui.automation.entry.pickerNothingLeft)).toBeTruthy();
  });

  it('клик по строке кладёт карточку типа задачи ПОВЕРХ с прямоугольником строки', () => {
    setup();
    const row = rowOf('Комплект');
    const rect = withRowRect(row);
    fireEvent.click(row);
    expect(openCardSpy).toHaveBeenCalledTimes(1);
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: TASK.id }, rect]]);
  });

  it('«⋯» строки: «Открыть» — карточка в стек, «Настройки типа…» — общий стор настроек', async () => {
    setup();
    const menu = await openRowMenu('Комплект');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([ui.common.open, ui.automation.menuSettingsType, ui.automation.entry.disconnect]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({
      kind: 'process-type',
      id: TASK.id,
    });
    expect(openCardSpy).not.toHaveBeenCalled();
    const second = await openRowMenu('Комплект');
    fireEvent.click(within(second).getByRole('menuitem', { name: ui.common.open }));
    // «Открыть» из меню — без прямоугольника источника (раскрытие из центра).
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: TASK.id }]]);
  });
});
