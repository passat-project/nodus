// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  transitions: [] as unknown[],
  run: vi.fn(),
}));

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowTransitions: () => ({ data: mocks.transitions }),
  gateReasonsText: () => 'нет подзадач',
}));
vi.mock('./task-transition-dialog.js', () => ({
  useTransitionRunner: () => ({ runningId: null, run: mocks.run, dialog: null }),
}));
vi.mock('../../../shared/workflow/route-view-dialog.js', () => ({
  RouteViewDialog: ({ open }: { open: boolean }) => (open ? <div>схема маршрута</div> : null),
}));

import { TaskStageField } from './task-stage-field.js';

afterEach(cleanup);
afterEach(() => {
  mocks.transitions = [];
  mocks.run.mockClear();
});

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  stage: { name: 'В работе', color: 'neutral', systemState: 'active', outcome: null },
  press: { transitionId: 'tp' },
} as unknown as TaskDetail;

const transitionOf = (
  id: string,
  name: string,
  toStageName: string,
  blockedBy: unknown[] = [],
): WorkflowTransition =>
  ({
    id,
    name,
    display: 'button',
    blockedBy,
    toStageState: 'closed',
    toStageOutcome: 'success',
    toStageName,
    toStageColor: 'success',
  }) as unknown as WorkflowTransition;

async function openStageMenu() {
  const trigger = screen.getByRole('button', { name: ui.tasks.fieldStage });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('TaskStageField: поле «Стадия» (#378)', () => {
  it('список стадий скрывает коллективную кнопку сбора и ведёт переход', async () => {
    mocks.transitions = [
      transitionOf('tp', 'Завершить', 'Готово'),
      transitionOf('tr2', 'Принять', 'Принята'),
    ];
    render(<TaskStageField task={task} />);

    const menu = await openStageMenu();
    expect(menu.textContent).toContain('Принята');
    expect(menu.textContent).not.toContain('Завершить');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Принята' }));
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'tr2' }));
  });

  it('заблокированная стадия подсказывает причину, «Схема маршрута…» открывает окно', async () => {
    mocks.transitions = [transitionOf('tr3', 'Отклонить', 'Отклонена', [{ kind: 'checklist' }])];
    render(<TaskStageField task={task} />);

    const menu = await openStageMenu();
    expect(screen.getByRole('menuitem', { name: 'Отклонена' }).getAttribute('title')).toBe(
      'нет подзадач',
    );

    fireEvent.click(screen.getByRole('menuitem', { name: ui.tasks.processRouteView }));
    expect(screen.getByText('схема маршрута')).toBeTruthy();
    expect(menu).toBeTruthy();
  });
});
