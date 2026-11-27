// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
const NEW_TYPE_ID = '44444444-4444-4444-8444-444444444444';

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
const LETTER = processType({
  id: 'l1',
  name: 'Входящее письмо',
  category: 'letter',
  excluded: [PROJECT_TYPE_ID],
});

/** Слот создания: захватываем onCreated — создаёт «окно» теста. */
function makeCreateSlot() {
  const slot = {
    onCreated: undefined as ((id: string) => void) | undefined,
    render: vi.fn((props: { onClose: () => void; onCreated: (id: string) => void }) =>
      (() => {
        slot.onCreated = props.onCreated;
        return <div data-testid="create-slot">slot</div>;
      })(),
    ),
  };
  return slot;
}

function setup(
  canSetup = true,
  tasks: ProcessType[] = [TASK],
  letters: ProcessType[] = [LETTER],
  manage = true,
  createSlot: ReturnType<typeof makeCreateSlot> | undefined = undefined,
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
  const view = render(
    <ProjectTypeCreationTab
      type={projectType}
      canSetup={canSetup}
      renderProcessTypeCreate={createSlot?.render}
    />,
  );
  return { mutate, view };
}

describe('вкладка «Что здесь можно создавать» — журнальный список (#665, #857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('показывает задачи и письма с чипами категорий; выключение пишет исключение', () => {
    const { mutate } = setup();
    expect(screen.getByText('Комплект')).toBeTruthy();
    expect(screen.getByText('Входящее письмо')).toBeTruthy();
    expect(screen.getByText(ui.automation.entry.categoryTask)).toBeTruthy();
    expect(screen.getByText(ui.automation.entry.categoryLetter)).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: /Комплект/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: TASK.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [PROJECT_TYPE_ID] }),
    });
  });

  it('включение снимает исключение — та же связь с другой стороны', () => {
    const { mutate } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /Входящее письмо/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: LETTER.id,
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('без права настройки тумблеры недоступны и кнопки создания нет', () => {
    setup(false);
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
    expect(screen.queryByText(ui.automation.entry.createTaskType)).toBeNull();
  });

  it('без права процессов — пояснение вместо 403', () => {
    setup(true, [TASK], [LETTER], false);
    expect(screen.getByText(ui.automation.creationScope.noWorkflowPermission)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
  });

  it('пустой список — спокойная подсказка', () => {
    setup(true, [], []);
    expect(screen.getByText(ui.automation.creationScope.empty)).toBeTruthy();
  });

  it('снятие работы, привязанной к типу папки, — предупреждение', () => {
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
    fireEvent.click(screen.getByRole('switch', { name: /Комплект/ }));
    expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      ui.automation.creationScope.unbindWarning,
    );
  });

  it('список без чекбоксов: массовых команд над выбранными строками нет, сводка — тихим текстом', () => {
    setup();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /выбранн/ })).toBeNull();
    // «Разрешено: 1 из 2» — сводка связки перед шестерёнкой вида.
    expect(screen.getByText(/1 из 2/)).toBeTruthy();
  });

  it('клик по строке (не по тумблеру) кладёт карточку типа задачи ПОВЕРХ с прямоугольником строки', () => {
    const { mutate } = setup();
    const row = rowOf('Комплект');
    const rect = withRowRect(row);
    fireEvent.click(row);
    expect(openCardSpy).toHaveBeenCalledTimes(1);
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: TASK.id }, rect]]);
    // Клик по тумблеру — правка связки, карточку не открывает.
    fireEvent.click(screen.getByRole('switch', { name: /Комплект/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(openCardSpy).toHaveBeenCalledTimes(1);
  });

  it('«⋯» строки: «Открыть» — карточка в стек, «Настройки типа…» — общий стор настроек', async () => {
    setup();
    const menu = await openRowMenu('Входящее письмо');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([ui.common.open, ui.automation.menuSettingsType]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({
      kind: 'process-type',
      id: LETTER.id,
    });
    expect(openCardSpy).not.toHaveBeenCalled();
    const second = await openRowMenu('Входящее письмо');
    fireEvent.click(within(second).getByRole('menuitem', { name: ui.common.open }));
    // «Открыть» из меню — без прямоугольника источника (раскрытие из центра).
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: LETTER.id }]]);
  });

  it('создать-и-связать: созданный тип дождётся живых данных и разрешится', () => {
    const slot = makeCreateSlot();
    const { mutate, view } = setup(true, [TASK], [LETTER], true, slot);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.createTaskType }));
    expect(screen.getByTestId('create-slot')).toBeTruthy();
    expect(slot.onCreated).toBeTruthy();

    // «Окно» создало тип: живые данные ещё без него — связка не пишется.
    act(() => slot.onCreated!(NEW_TYPE_ID));
    expect(mutate).not.toHaveBeenCalled();

    // Справочник перечитан: тип появился — связка пишется в его настройку.
    vi.mocked(useLiveProcessTypes).mockImplementation(
      (category) =>
        ({
          data:
            category === 'task'
              ? [TASK, processType({ id: NEW_TYPE_ID, name: 'Новый', category: 'task' })]
              : [LETTER],
        }) as never,
    );
    act(() => {
      view.rerender(
        <ProjectTypeCreationTab
          type={projectType}
          canSetup
          renderProcessTypeCreate={slot.render}
        />,
      );
    });
    expect(mutate).toHaveBeenCalledWith({
      typeId: NEW_TYPE_ID,
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });
});
