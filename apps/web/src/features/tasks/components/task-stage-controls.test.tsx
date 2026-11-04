// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Check, X } from 'lucide-react';
import type { TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowTransitions: () => ({ data: [] }),
  gateReasonsText: () => '',
}));
vi.mock('./task-transition-dialog.js', () => ({
  useTransitionRunner: () => ({ runningId: null, run: vi.fn(), dialog: null }),
}));
vi.mock('./task-time.js', () => ({ TaskTimerButton: () => null }));

import { TaskActionBar, transitionIcon } from './task-stage-controls.js';

afterEach(cleanup);

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
