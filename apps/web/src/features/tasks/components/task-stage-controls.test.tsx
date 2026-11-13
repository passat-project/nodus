// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Check, X } from 'lucide-react';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';

const state = vi.hoisted(() => ({
  transitions: [] as WorkflowTransition[],
  submit: vi.fn(),
}));

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowTransitions: () => ({ data: state.transitions }),
  gateReasonsText: () => '',
}));
vi.mock('./task-transition-dialog.js', () => ({
  useTransitionRunner: () => ({ runningId: null, run: vi.fn(), dialog: null }),
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

afterEach(() => {
  cleanup();
  state.transitions = [];
  state.submit.mockClear();
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
