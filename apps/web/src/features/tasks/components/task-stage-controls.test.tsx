// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Check, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';

const state = vi.hoisted(() => ({
  transitions: [] as WorkflowTransition[],
  submit: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  actionRun: vi.fn(),
  actions: [] as unknown[],
  transitions: [] as unknown[],
  transitionRun: vi.fn(),
}));

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowTransitions: () => ({ data: [...mocks.transitions, ...state.transitions] }),
  gateReasonsText: () => 'нет отметки',
}));
vi.mock('./task-transition-dialog.js', () => ({
  useTransitionRunner: () => ({ runningId: null, run: mocks.transitionRun, dialog: null }),
}));
vi.mock('./task-action-runner.js', () => ({
  useActionRunner: () => ({
    actions: mocks.actions,
    runningId: null,
    run: mocks.actionRun,
    dialog: null,
  }),
}));
vi.mock('../api/press-api.js', () => ({
  useSubmitPress: () => ({ mutate: state.submit }),
  useWithdrawPress: () => ({ mutate: vi.fn() }),
  useReturnPress: () => ({ mutate: vi.fn(), isPending: false }),
  useExcludePress: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./task-press-dialogs.js', () => ({
  PressAnalyticsDialog: () => null,
  PressSubmitDialog: () => null,
  pressHasWindow: () => false,
}));
vi.mock('./task-time.js', () => ({ TaskTimerButton: () => null }));

import { TaskActionBar, transitionIcon } from './task-stage-controls.js';

afterEach(cleanup);
afterEach(() => {
  mocks.actions = [];
  mocks.transitions = [];
  mocks.actionRun.mockClear();
  mocks.transitionRun.mockClear();
  state.transitions = [];
  state.submit.mockClear();
});

const transition = (outcome: 'success' | 'cancelled' | 'rejected' | null): WorkflowTransition =>
  ({ toStageState: 'closed', toStageOutcome: outcome }) as WorkflowTransition;

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  stage: { name: 'Отклонена', color: 'danger', systemState: 'closed', outcome: 'rejected' },
  access: { canEdit: true },
} as unknown as TaskDetail;

/** Действие в панели: только поля, которые читает бар (#633). */
const action = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  display: 'button',
  form: null,
  blockedBy: [],
  validators: [],
  ...overrides,
});

const transitionOf = (
  id: string,
  name: string,
  display: 'primary' | 'button' | 'menu',
  blockedBy: unknown[] = [],
): WorkflowTransition =>
  ({
    id,
    name,
    display,
    blockedBy,
    toStageState: 'active',
    toStageOutcome: null,
    toStageName: name,
    toStageColor: 'port',
  }) as unknown as WorkflowTransition;

const activeTask = { ...task, stage: { ...task.stage, systemState: 'active' } } as TaskDetail;

/** Слот-кнопка и её стрелка — по подписи слота. */
const slotTrigger = (label: string) => screen.getByRole('button', { name: label });

async function openSlot(label: string) {
  const trigger = slotTrigger(label);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('TaskActionBar: итог «Отклонена» (#430)', () => {
  it('иконка итога различает успех и отказ/отмену', () => {
    expect(transitionIcon(transition('success'))).toBe(Check);
    expect(transitionIcon(transition('rejected'))).toBe(X);
    expect(transitionIcon(transition('cancelled'))).toBe(X);
  });

  it('закрытая задача с итогом rejected показывает отказ, а не успех', () => {
    render(<TaskActionBar task={task} showTime={false} />);
    expect(screen.getByText('Отклонена')).toBeTruthy();
    expect(screen.getByText('Нет доступных действий')).toBeTruthy();
  });

  it('коллективная кнопка: нажатие без окна и статус после сдачи', () => {
    const pressTask = {
      ...task,
      stage: { name: 'В работе', systemState: 'active', outcome: null },
      press: {
        transitionId: 'tr-press',
        transitionName: 'Завершить',
        pressed: 1,
        total: 2,
        canSubmit: true,
        entries: [],
      },
    } as unknown as TaskDetail;
    state.transitions = [
      {
        id: 'tr-press',
        name: 'Завершить',
        toStageState: 'active',
        toStageName: 'В работе',
        display: 'primary',
        blockedBy: [],
      } as unknown as WorkflowTransition,
    ];
    const { unmount } = render(<TaskActionBar task={pressTask} showTime={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(state.submit).toHaveBeenCalledWith({});
    unmount();

    state.transitions = [];
    render(
      <TaskActionBar
        task={{ ...pressTask, press: { ...pressTask.press, canSubmit: false } } as TaskDetail}
        showTime={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Статусы участников: 1 \/ 2/ })).toBeTruthy();
  });
});

describe('TaskActionBar: слоты панели (решение 16.11.2026)', () => {
  it('коллективная кнопка не прячется в список: первая во второстепенных', async () => {
    const pressTask = {
      ...activeTask,
      press: {
        transitionId: 'tp',
        transitionName: 'Завершить',
        pressed: 1,
        total: 3,
        canSubmit: true,
        entries: [],
      },
    } as unknown as TaskDetail;
    state.transitions = [
      transitionOf('t1', 'В работу', 'primary'),
      transitionOf('t2', 'На проверку', 'button'),
      transitionOf('tp', 'Завершить', 'menu'),
    ];
    render(<TaskActionBar task={pressTask} showTime={false} />);

    // Даже с показом `menu` коллективная кнопка видна сразу, с кольцом.
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy();
    const menu = await openSlot(ui.tasks.moreActions);
    expect(within(menu).queryByRole('menuitem', { name: /Завершить/ })).toBeNull();
  });

  it('одно действие — обычная кнопка без стрелки, клик уходит в раннер', () => {
    mocks.actions = [action('a1', 'Запросить уточнение')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const button = screen.getByRole('button', { name: 'Запросить уточнение' });
    fireEvent.click(button);
    expect(mocks.actionRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', name: 'Запросить уточнение' }),
    );
    // Стрелки слота нет: одна кнопка — без списка.
    expect(screen.queryByRole('button', { name: ui.tasks.actionsMenu })).toBeNull();
    expect(screen.queryByText(ui.tasks.processNoActions)).toBeNull();
  });

  it('два действия — первая нажимается сразу, у стрелки — список остальных', async () => {
    mocks.transitions = [transitionOf('t1', 'В работу', 'primary')];
    mocks.actions = [action('a1', 'Первое'), action('a2', 'Второе')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Первое' }));
    expect(mocks.actionRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    // Второй кнопки в строке нет — она в списке.
    expect(screen.queryByRole('button', { name: 'Второе' })).toBeNull();

    const menu = await openSlot(ui.tasks.actionsMenu);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Второе']);
  });

  it('показ `menu` — действие в конце списка, дефолтной кнопкой становится обычное', async () => {
    mocks.transitions = [transitionOf('t1', 'В работу', 'primary')];
    mocks.actions = [action('rare', 'В конец', { display: 'menu' }), action('a2', 'Обычное')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    // Обычное действие — кнопка слота, «в конец» — только в списке.
    expect(screen.getByRole('button', { name: 'Обычное' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'В конец' })).toBeNull();

    const menu = await openSlot(ui.tasks.actionsMenu);
    expect(within(menu).getByRole('menuitem', { name: /В конец/ })).toBeTruthy();
  });

  it('заблокированное действие в списке показывает причину текстом в строке', async () => {
    mocks.transitions = [transitionOf('t1', 'В работу', 'primary')];
    mocks.actions = [
      action('a1', 'Свободное'),
      action('a2', 'С гейтом', { blockedBy: [{ kind: 'time_logged' }] }),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const menu = await openSlot(ui.tasks.actionsMenu);
    const row = within(menu).getByRole('menuitem', { name: /С гейтом/ });
    expect(row.getAttribute('data-blocked')).toBe('true');
    // Причина — текстом, а не только подсказкой наведения.
    expect(row.textContent).toContain(ui.tasks.processBlockedMissing);

    fireEvent.click(row);
    expect(mocks.actionRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('в панели нет меню «⋯»: редкий переход живёт в слоте второстепенных', async () => {
    mocks.transitions = [
      transitionOf('t1', 'В работу', 'primary'),
      transitionOf('t2', 'На проверку', 'button'),
      transitionOf('t3', 'Отложить', 'menu'),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    expect(screen.getByRole('button', { name: 'В работу' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'На проверку' })).toBeTruthy();
    // Кнопки «⋯» больше нет — её место занимает стрелка слота.
    const menu = await openSlot(ui.tasks.moreActions);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Отложить']);
  });

  it('заблокированный переход в слоте: причина видна в строке списка', async () => {
    mocks.transitions = [
      transitionOf('t1', 'В работу', 'primary'),
      transitionOf('t2', 'На проверку', 'button'),
      transitionOf('t3', 'Отложить', 'menu', [{ kind: 'time_logged' }]),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    // Кнопка слота — первая второстепенная; список открывается стрелкой.
    fireEvent.click(screen.getByRole('button', { name: 'На проверку' }));
    expect(mocks.transitionRun).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));

    const menu = await openSlot(ui.tasks.moreActions);
    const row = within(menu).getByRole('menuitem', { name: /Отложить/ });
    expect(row.getAttribute('data-blocked')).toBe('true');
    expect(row.textContent).toContain(ui.tasks.processBlockedMissing);
  });

  it('без переходов главным становится первое действие (залитая кнопка)', () => {
    mocks.actions = [action('a1', 'Добавить замечание')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const main = screen.getByRole('button', { name: 'Добавить замечание' });
    expect(main.className).toContain('bg-primary');
  });

  it('панель держит одну строку: главная не сжимается', () => {
    mocks.transitions = [
      transitionOf('t1', 'Коллективное согласование', 'primary'),
      transitionOf('t2', 'Приостановить', 'button'),
    ];
    mocks.actions = [action('a1', 'Запросить уточнение'), action('a2', 'Вернуть автору')];
    const { container } = render(<TaskActionBar task={activeTask} showTime={false} />);

    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('flex-nowrap');
    expect(panel.className).not.toContain('flex-wrap');

    const main = screen.getByRole('button', { name: 'Коллективное согласование' });
    expect(main.className).toContain('shrink-0');
    // Главная подпись не прячется в узком контейнере.
    expect(main.textContent).toContain('Коллективное согласование');
    expect(screen.getByRole('group', { name: ui.tasks.actionsMenu })).toBeTruthy();
  });
});
