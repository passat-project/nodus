// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TaskDetail } from '@nodus/contracts';

vi.mock('../../../shared/tasks/quick-create.js', () => ({
  useQuickCreate: () => ({ run: vi.fn() }),
}));

import { TaskSubtasks } from './task-subtasks.js';

afterEach(cleanup);

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  number: 7,
  deadline: null,
  access: { canEdit: false },
  subtasks: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      number: 1,
      title: 'Отклонённая',
      deadline: null,
      assignee: null,
      stage: { name: 'Отклонена', color: 'danger', systemState: 'closed', outcome: 'rejected' },
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      number: 2,
      title: 'Выполненная',
      deadline: null,
      assignee: null,
      stage: { name: 'Выполнена', color: 'success', systemState: 'closed', outcome: 'success' },
    },
  ],
} as unknown as TaskDetail;

describe('TaskSubtasks: rejected не считается выполненной (#430)', () => {
  it('счётчик готовых учитывает только success', () => {
    render(<TaskSubtasks task={task} onOpen={() => undefined} />);

    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('Выполненная').className).toContain('line-through');
    expect(screen.getByText('Отклонённая').className).not.toContain('line-through');
  });
});
