// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Check, X } from 'lucide-react';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  actionRun: vi.fn(),
  actions: [] as unknown[],
  transitions: [] as unknown[],
  transitionRun: vi.fn(),
}));

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowTransitions: () => ({ data: mocks.transitions }),
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
vi.mock('./task-time.js', () => ({ TaskTimerButton: () => null }));

import { TaskActionBar, transitionIcon } from './task-stage-controls.js';

afterEach(cleanup);
afterEach(() => {
  mocks.actions = [];
  mocks.transitions = [];
  mocks.actionRun.mockClear();
  mocks.transitionRun.mockClear();
});

const transition = (outcome: 'success' | 'cancelled' | 'rejected' | null): WorkflowTransition =>
  ({ toStageState: 'closed', toStageOutcome: outcome }) as WorkflowTransition;

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  stage: {
    name: 'Отклонена',
    color: 'danger',
    systemState: 'closed',
    outcome: 'rejected',
  },
  access: { canEdit: true },
} as unknown as TaskDetail;

describe('TaskActionBar: итог «Отклонена» (#430)', () => {
  it('иконка итога различает успех и отказ/отмену', () => {
    expect(transitionIcon(transition('success'))).toBe(Check);
    expect(transitionIcon(transition('rejected'))).toBe(X);
    expect(transitionIcon(transition('cancelled'))).toBe(X);
  });

  it('закрытая задача с итогом rejected показывает отказ, а не успех', () => {
    render(<TaskActionBar task={task} showTime={false} />);

    expect(screen.getByText('Отклонена')).toBeTruthy();
    expect(screen.getByText(ui.tasks.processNoActions)).toBeTruthy();
  });
});

describe('TaskActionBar: действие без смены статуса (#633)', () => {
  it('кнопка действия в панели, клик уходит в раннер действий', () => {
    mocks.actions = [
      {
        id: 'a1',
        name: 'Запросить уточнение',
        display: 'button',
        form: null,
        blockedBy: [],
        validators: [],
      },
    ];
    render(
      <TaskActionBar
        task={{ ...task, stage: { ...task.stage, systemState: 'active' } }}
        showTime={false}
      />,
    );

    const button = screen.getByRole('button', { name: 'Запросить уточнение' });
    fireEvent.click(button);
    expect(mocks.actionRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', name: 'Запросить уточнение' }),
    );
    // «Нет доступных действий» не показывается, хотя переходов нет.
    expect(screen.queryByText(ui.tasks.processNoActions)).toBeNull();
  });

  it('заблокированное действие видно, помечено и объясняет причину (#740)', () => {
    mocks.actions = [
      {
        id: 'a2',
        name: 'С гейтом',
        display: 'button',
        form: null,
        blockedBy: [{ kind: 'time_logged' }],
        validators: [{ kind: 'time_logged' }],
      },
    ];
    render(
      <TaskActionBar
        task={{ ...task, stage: { ...task.stage, systemState: 'active' } }}
        showTime={false}
      />,
    );

    const button = screen.getByRole('button', { name: 'С гейтом' });
    expect(button.getAttribute('data-blocked')).toBe('true');
    expect(button.getAttribute('title')).toContain(ui.tasks.processBlockedMissing);
  });
});

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
): WorkflowTransition =>
  ({
    id,
    name,
    display,
    blockedBy: [],
    toStageState: 'active',
    toStageOutcome: null,
    toStageName: name,
    toStageColor: 'port',
  }) as unknown as WorkflowTransition;

const activeTask = { ...task, stage: { ...task.stage, systemState: 'active' } } as TaskDetail;

const actionsTrigger = (count: number) =>
  screen.getByRole('button', { name: `${ui.tasks.allActionsLabel} ${count}` });

/** Левая часть сдвоенной кнопки — выполнить дефолтное действие. */
const defaultActionButton = (name: string) =>
  screen.getByRole('button', { name: `${ui.tasks.actionRunLabel} ${name}` });

/** Открытие меню с клавиатуры — как у пунктов профиля (#751): фокус + Enter. */
async function openActionsMenu(count: number) {
  const trigger = actionsTrigger(count);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('TaskActionBar: порог действий — меню «Действия» (#633, #707)', () => {
  it('одно действие — отдельная кнопка с полным названием, меню нет', () => {
    mocks.actions = [action('a1', 'Запросить уточнение по смете')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const button = screen.getByRole('button', { name: 'Запросить уточнение по смете' });
    // Полное имя: подпись не обрезается и не ограничена шириной.
    const label = button.lastElementChild as HTMLElement;
    expect(label.textContent).toBe('Запросить уточнение по смете');
    expect(label.className).toContain('whitespace-nowrap');
    expect(label.className).not.toContain('truncate');
    expect(label.className).not.toContain('max-w-');
    expect(screen.queryByRole('button', { name: `${ui.tasks.allActionsLabel} 1` })).toBeNull();
  });

  it('одно действие с display:menu — всё равно список «Действия» (настройку не теряем)', async () => {
    mocks.actions = [action('a1', 'В меню', { display: 'menu' })];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    // Дефолтной кнопки нет — только триггер меню (в шапке — «Действия · 1»).
    expect(screen.queryByRole('button', { name: 'В меню' })).toBeNull();
    await openActionsMenu(1);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['В меню']);
  });

  it('одно действие с display:primary — отдельная (залитая) кнопка, не список', () => {
    mocks.actions = [action('a1', 'Главное действие', { display: 'primary' })];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    expect(screen.getByRole('button', { name: 'Главное действие' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${ui.tasks.allActionsLabel} 1` })).toBeNull();
  });

  it('два действия — сдвоенная кнопка: дефолт слева, меню справа', async () => {
    mocks.actions = [
      action('a1', 'Первое', { display: 'menu' }),
      action('a2', 'Второе', { form: { enabled: true, sections: [] } }),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    // Первое помечено «в меню» — дефолтной кнопки нет, только шеврон.
    expect(screen.queryByRole('button', { name: `${ui.tasks.actionRunLabel} Первое` })).toBeNull();
    await openActionsMenu(2);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('заблокированное дефолтное действие — клик открывает причины, не молчит', () => {
    mocks.actions = [
      action('a1', 'С гейтом', { blockedBy: [{ kind: 'time_logged' }] }),
      action('a2', 'Второе'),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const left = defaultActionButton('С гейтом');
    expect(left.getAttribute('data-blocked')).toBe('true');
    expect(left.getAttribute('title')).toContain(ui.tasks.processBlockedMissing);
    // Тот же обработчик: раннер сам покажет окно причин / тост.
    fireEvent.click(left);
    expect(mocks.actionRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('три действия — сдвоенная кнопка с дефолтным действием и шевроном', async () => {
    mocks.actions = [
      action('a1', 'Первое'),
      action('a2', 'Второе', { form: { enabled: true, sections: [] } }),
      action('a3', 'Третье'),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    // Левая часть — имя первого действия, клик идёт в тот же раннер.
    fireEvent.click(defaultActionButton('Первое'));
    expect(mocks.actionRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    // Отдельных кнопок остальных действий в строке нет.
    expect(screen.queryByRole('button', { name: 'Второе' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Третье' })).toBeNull();

    await openActionsMenu(3);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Первое',
      'Второе',
      'Третье',
    ]);
  });

  it('заблокированное действие — маркер причины справа, клик идёт в раннер', async () => {
    // Подробности маркера — в task-actions-menu.test.tsx; здесь важен путь
    // нажатия из меню: тот же раннер, что у кнопки.
    mocks.actions = [
      action('a1', 'Свободное'),
      action('a2', 'С гейтом', { blockedBy: [{ kind: 'time_logged' }] }),
    ];
    render(<TaskActionBar task={activeTask} showTime={false} />);
    await openActionsMenu(2);

    const blocked = screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent?.includes('С гейтом')) as HTMLElement;
    expect(blocked.getAttribute('data-blocked')).toBe('true');

    fireEvent.click(blocked);
    expect(mocks.actionRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }));
    // Меню закрылось после выполнения.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('TaskActionBar: коллективная кнопка — это переход (#707)', () => {
  it('широкий переход рисуется своим рядом, действия не дублируются', async () => {
    // Коллективное нажатие в #707 — обычный переход с кольцом прогресса:
    // наш бар её не различает. Моделируем «широкой» кнопкой и проверяем,
    // что панель не падает, не дублирует действия и уводит их в меню.
    mocks.transitions = [transitionOf('press', 'Коллективное согласование', 'primary')];
    mocks.actions = [action('a1', 'Первое'), action('a2', 'Второе')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const press = screen.getByRole('button', { name: 'Коллективное согласование' });
    // Переход-коллективка — одна кнопка, спаренных копий нет.
    expect(screen.getAllByRole('button', { name: 'Коллективное согласование' })).toHaveLength(1);
    expect(press.getAttribute('data-blocked')).toBeNull();

    await openActionsMenu(2);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('порядок панели: переходы → действия → «⋯» процесса', async () => {
    mocks.transitions = [
      transitionOf('t1', 'В работу', 'primary'),
      transitionOf('t2', 'На проверку', 'button'),
      transitionOf('t3', 'Отложить', 'menu'),
    ];
    mocks.actions = [action('a1', 'Первое'), action('a2', 'Второе')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const transitionBtn = screen.getByRole('button', { name: 'В работу' });
    const trigger = actionsTrigger(2);
    const more = screen.getByRole('button', { name: ui.tasks.moreActions });

    const order = (a: HTMLElement, b: HTMLElement) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(transitionBtn, trigger)).toBeTruthy();
    expect(order(trigger, more)).toBeTruthy();
  });
});

describe('TaskActionBar: одна строка и приоритет действий (#633)', () => {
  it('2 перехода (один коллективный) + 2 действия — одна строка, действия в дропдаун', () => {
    mocks.transitions = [
      transitionOf('t1', 'Коллективное согласование', 'primary'),
      transitionOf('t2', 'Приостановить', 'button'),
    ];
    mocks.actions = [action('a1', 'Запросить уточнение'), action('a2', 'Вернуть автору')];
    const { container } = render(<TaskActionBar task={activeTask} showTime={false} />);

    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('flex-nowrap');
    expect(panel.className).not.toContain('flex-wrap');
    expect(panel.className).toContain('min-w-0');

    // Переходы — полные имена, не ужимаются под действия.
    const press = screen.getByRole('button', { name: 'Коллективное согласование' });
    const pause = screen.getByRole('button', { name: 'Приостановить' });
    expect(press.className).toContain('shrink-0');
    expect(pause.className).toContain('shrink-0');
    expect(press.getAttribute('title')).toContain('Коллективное согласование');

    // Действия — один блок (сдвоенная кнопка) в строке панели.
    const split = screen.getByRole('group', { name: ui.tasks.actionsMenu });
    expect(split.parentElement).toBe(panel);
    expect(actionsTrigger(2).parentElement).toBe(split);
    expect(screen.queryByRole('button', { name: 'Запросить уточнение' })).toBeNull();
  });

  it('одно действие — кнопка ужимается первой (значок + подсказка)', () => {
    mocks.transitions = [transitionOf('t1', 'В работу', 'primary')];
    mocks.actions = [action('a1', 'Запросить уточнение')];
    render(<TaskActionBar task={activeTask} showTime={false} />);

    const actionBtn = screen.getByRole('button', { name: 'Запросить уточнение' });
    // Подпись действия прячется в узком контейнере, полное имя — в title.
    expect(actionBtn.className).toContain('[flex-shrink:3]');
    expect(actionBtn.getAttribute('title')).toBe('Запросить уточнение');
  });
});
