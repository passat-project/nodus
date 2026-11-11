// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Check, X } from 'lucide-react';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  actionRun: vi.fn(),
  actions: [] as unknown[],
}));

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowTransitions: () => ({ data: [] }),
  gateReasonsText: () => '',
}));
vi.mock('./task-transition-dialog.js', () => ({
  useTransitionRunner: () => ({ runningId: null, run: vi.fn(), dialog: null }),
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
  mocks.actionRun.mockClear();
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
      { id: 'a1', name: 'Запросить уточнение', display: 'button', form: null, blockedBy: [] },
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
